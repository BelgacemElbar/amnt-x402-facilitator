/**
 * The settlement log and the discovery list.
 *
 * SQLite by default (Node's built-in node:sqlite, nothing to install or run).
 * Postgres when DATABASE_URL is set - use that anywhere the disk doesn't last,
 * like Vercel.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Row = {
  env: "mainnet" | "testnet";
  network: string;
  scheme: string;
  kind: "verify" | "settle";
  status: "settled" | "failed" | "rejected";
  payer: string | null;
  pay_to: string | null;
  asset: string | null;
  amount_atomic: string | null;
  resource_url: string | null;
  tx_id: string | null;
  payment_hash: string | null;
  error_reason: string | null;
  error_message: string | null;
  fee_payer: string | null;
  total_ms: number | null;
  created_at: string;
};

export type Resource = { resource: string; accepts: unknown; metadata: unknown; settled_count: number; last_updated: string };

export type TxQuery = { env: string; network?: string; status?: string; before?: string; limit: number };

export interface Store {
  insert(row: Row): Promise<void>;
  settledTx(paymentHash: string): Promise<string | null>;
  /** Settle rows since a time, for stats. */
  settles(env: string, network: string | null, since: string): Promise<Row[]>;
  transactions(q: TxQuery): Promise<Row[]>;
  upsertResource(resource: string, accepts: unknown, metadata: unknown): Promise<void>;
  resources(since: string, limit: number, offset: number): Promise<{ items: Resource[]; total: number }>;
}

const COLUMNS = ["env", "network", "scheme", "kind", "status", "payer", "pay_to", "asset", "amount_atomic", "resource_url", "tx_id", "payment_hash", "error_reason", "error_message", "fee_payer", "total_ms", "created_at"] as const;

const SCHEMA = `
create table if not exists settlements (
  id integer primary key ${"/*AUTO*/"},
  ${COLUMNS.map((c) => `${c} ${c === "total_ms" ? "integer" : "text"}`).join(",\n  ")}
);
create unique index if not exists settlements_settled_hash on settlements (payment_hash) where status = 'settled' and payment_hash is not null;
create index if not exists settlements_recent on settlements (env, network, created_at);
create table if not exists resources (
  resource text primary key,
  accepts text not null,
  metadata text not null,
  settled_count integer not null default 0,
  last_updated text not null
);`;

export async function openStore(env: Record<string, string | undefined> = process.env): Promise<Store> {
  return env.DATABASE_URL ? postgresStore(env.DATABASE_URL) : sqliteStore(env.SQLITE_PATH || "./data/facilitator.db");
}

export async function sqliteStore(path: string): Promise<Store> {
  const { DatabaseSync } = await import("node:sqlite");
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA.replace("/*AUTO*/", "autoincrement"));
  const parse = (r: any): Resource => ({ ...r, accepts: JSON.parse(r.accepts), metadata: JSON.parse(r.metadata) });

  return {
    async insert(row) {
      db.prepare(`insert into settlements (${COLUMNS.join(",")}) values (${COLUMNS.map(() => "?").join(",")})`).run(...COLUMNS.map((c) => row[c] as any));
    },
    async settledTx(hash) {
      const r: any = db.prepare("select tx_id from settlements where payment_hash = ? and status = 'settled'").get(hash);
      return r?.tx_id ?? null;
    },
    async settles(env, network, since) {
      return db
        .prepare(`select * from settlements where env = ? and kind = 'settle' and created_at >= ? ${network ? "and network = ?" : ""}`)
        .all(...[env, since, ...(network ? [network] : [])]) as any;
    },
    async transactions(q) {
      const where = ["env = ?"];
      const args: any[] = [q.env];
      if (q.network) (where.push("network = ?"), args.push(q.network));
      if (q.status) (where.push("status = ?"), args.push(q.status));
      if (q.before) (where.push("created_at < ?"), args.push(q.before));
      return db.prepare(`select * from settlements where ${where.join(" and ")} order by created_at desc limit ?`).all(...args, q.limit) as any;
    },
    async upsertResource(resource, accepts, metadata) {
      db.prepare(
        `insert into resources (resource, accepts, metadata, settled_count, last_updated) values (?, ?, ?, 1, ?)
         on conflict (resource) do update set accepts = excluded.accepts, metadata = excluded.metadata, settled_count = settled_count + 1, last_updated = excluded.last_updated`,
      ).run(resource, JSON.stringify(accepts), JSON.stringify(metadata), new Date().toISOString());
    },
    async resources(since, limit, offset) {
      const items = db.prepare("select * from resources where last_updated >= ? order by last_updated desc limit ? offset ?").all(since, limit, offset).map(parse);
      const total = (db.prepare("select count(*) as n from resources where last_updated >= ?").get(since) as any).n;
      return { items, total };
    },
  };
}

export async function postgresStore(url: string): Promise<Store> {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  await pool.query(SCHEMA.replace("integer primary key /*AUTO*/", "bigint generated always as identity primary key"));
  const q = async (text: string, args: unknown[] = []) => (await pool.query(text, args)).rows;
  const n = (i: number) => `$${i}`;

  return {
    async insert(row) {
      await q(`insert into settlements (${COLUMNS.join(",")}) values (${COLUMNS.map((_, i) => n(i + 1)).join(",")})`, COLUMNS.map((c) => row[c]));
    },
    async settledTx(hash) {
      return (await q("select tx_id from settlements where payment_hash = $1 and status = 'settled'", [hash]))[0]?.tx_id ?? null;
    },
    async settles(env, network, since) {
      return q(`select * from settlements where env = $1 and kind = 'settle' and created_at >= $2 ${network ? "and network = $3" : ""}`, [env, since, ...(network ? [network] : [])]) as any;
    },
    async transactions(t) {
      const where = ["env = $1"];
      const args: unknown[] = [t.env];
      if (t.network) (args.push(t.network), where.push(`network = ${n(args.length)}`));
      if (t.status) (args.push(t.status), where.push(`status = ${n(args.length)}`));
      if (t.before) (args.push(t.before), where.push(`created_at < ${n(args.length)}`));
      args.push(t.limit);
      return q(`select * from settlements where ${where.join(" and ")} order by created_at desc limit ${n(args.length)}`, args) as any;
    },
    async upsertResource(resource, accepts, metadata) {
      await q(
        `insert into resources (resource, accepts, metadata, settled_count, last_updated) values ($1, $2, $3, 1, $4)
         on conflict (resource) do update set accepts = excluded.accepts, metadata = excluded.metadata, settled_count = resources.settled_count + 1, last_updated = excluded.last_updated`,
        [resource, JSON.stringify(accepts), JSON.stringify(metadata), new Date().toISOString()],
      );
    },
    async resources(since, limit, offset) {
      const items = (await q("select * from resources where last_updated >= $1 order by last_updated desc limit $2 offset $3", [since, limit, offset])).map((r: any) => ({
        ...r, accepts: JSON.parse(r.accepts), metadata: JSON.parse(r.metadata),
      }));
      const total = Number((await q("select count(*) as n from resources where last_updated >= $1", [since]))[0].n);
      return { items, total };
    },
  };
}
