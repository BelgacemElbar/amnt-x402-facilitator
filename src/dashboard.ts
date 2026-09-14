/**
 * The dashboard every instance serves at /dashboard. One static page, no
 * build step, reading this instance's own /stats, /transactions and /health.
 */
export const dashboardHtml = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>x402 facilitator dashboard</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#141a22;--muted:#667085;--line:#e2e6ec;--accent:#2563eb;--good:#16794a;--bad:#b42318}
@media (prefers-color-scheme:dark){:root{--bg:#0e1116;--card:#161b22;--ink:#e6e9ee;--muted:#8b95a3;--line:#2a313b;--accent:#6ea0ff;--good:#4cc38a;--bad:#f07167}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:1100px;margin:0 auto;padding:32px 16px}h1{font-size:24px;margin:0}p{margin:0}
.muted{color:var(--muted)}.row{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin:16px 0}
.tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}@media(max-width:700px){.tiles{grid-template-columns:repeat(2,minmax(0,1fr))}}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px}.big{font-size:22px;font-weight:650;font-variant-numeric:tabular-nums}
.bars{display:flex;align-items:flex-end;gap:2px;height:120px;border-bottom:1px solid var(--line);margin-top:12px}.bars div{flex:1;background:var(--accent);opacity:.8;border-radius:2px 2px 0 0}
.wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}a{color:var(--accent)}
.pill{padding:2px 8px;border-radius:99px;font-size:12px}.settled{color:var(--good)}.failed{color:var(--bad)}.rejected{color:var(--muted)}
select,button{font:inherit;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:6px;padding:4px 8px}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--muted);margin-right:6px}
</style>
</head>
<body>
<main>
  <div class="row">
    <div><h1>x402 facilitator</h1><p class="muted" id="status"><span class="dot"></span>Checking…</p></div>
    <div>
      <select id="env" aria-label="Network type"><option value="mainnet">Mainnet</option><option value="testnet">Testnet</option></select>
      <select id="days" aria-label="Time range"><option value="14">14 days</option><option value="90">90 days</option></select>
    </div>
  </div>
  <div class="tiles">
    <div class="card"><p class="muted">Settlements</p><p class="big" id="t-count">…</p></div>
    <div class="card"><p class="muted">Volume</p><p class="big" id="t-volume">…</p></div>
    <div class="card"><p class="muted">Success rate</p><p class="big" id="t-rate">…</p></div>
    <div class="card"><p class="muted">Median settle time</p><p class="big" id="t-ms">…</p></div>
  </div>
  <div class="card" style="margin-top:12px"><p>Settlements per day</p><div class="bars" id="bars" role="img" aria-label="Settlements per day"></div></div>
  <div class="card" style="margin-top:12px"><p>Fee payers</p><div id="payers" class="muted">…</div></div>
  <div class="card" style="margin-top:12px">
    <div class="row" style="margin:0 0 8px"><p>Transactions</p>
      <select id="status-filter" aria-label="Status"><option value="">All statuses</option><option value="settled">Settled</option><option value="failed">Failed</option><option value="rejected">Refused</option></select>
    </div>
    <div class="wrap"><table><thead><tr><th>Time</th><th>Network</th><th>Amount</th><th>Paid for</th><th>Status</th><th>Transaction</th></tr></thead><tbody id="txs"></tbody></table></div>
    <p style="margin-top:8px"><button id="more" hidden>Load more</button></p>
  </div>
</main>
<script>
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const usd = (a) => "$" + (Number(a || 0) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
let cursor = null;

async function load() {
  const env = $("env").value, days = $("days").value;
  const s = await fetch("stats?env=" + env + "&days=" + days).then((r) => r.json()).catch(() => null);
  if (s) {
    $("t-count").textContent = s.settlements.toLocaleString();
    $("t-volume").textContent = usd(s.volumeAtomic);
    $("t-rate").textContent = s.successRate == null ? "-" : s.successRate + "%";
    $("t-ms").textContent = s.medianSettleMs ? (s.medianSettleMs / 1000).toFixed(1) + " s" : "-";
    const max = Math.max(1, ...s.daily.map((d) => d.count));
    $("bars").innerHTML = s.daily.map((d) => '<div title="' + esc(d.day + ": " + d.count) + '" style="height:' + (d.count ? Math.max(4, (d.count / max) * 100) : 0) + '%"></div>').join("");
  }
  const h = await fetch("health").then((r) => r.json()).catch(() => null);
  const ok = h && h.status === "ok";
  $("status").innerHTML = '<span class="dot" style="background:var(--' + (ok ? "good" : "bad") + ')"></span>' + (ok ? "Operational" : h ? "Degraded: a fee payer is low" : "Unreachable");
  $("payers").innerHTML = (h?.chains || []).map((c) => esc(c.network) + " · " + esc(c.feePayer) + " · " + (c.balance == null ? "?" : c.balance.toFixed(4) + " " + esc(c.unit))).join("<br>") || "None";
  cursor = null;
  $("txs").innerHTML = "";
  await more();
}

async function more() {
  const q = new URLSearchParams({ env: $("env").value, limit: "25" });
  if ($("status-filter").value) q.set("status", $("status-filter").value);
  if (cursor) q.set("cursor", cursor);
  const d = await fetch("transactions?" + q).then((r) => r.json()).catch(() => ({ transactions: [] }));
  $("txs").insertAdjacentHTML("beforeend", d.transactions.map((t) => "<tr><td>" + esc(new Date(t.created_at).toLocaleString()) + "</td><td>" + esc(t.network) + "</td><td>" + (t.amount_atomic ? usd(t.amount_atomic) : "-") + "</td><td>" + esc(t.resource_url || "-") + '</td><td><span class="pill ' + esc(t.status) + '">' + esc(t.status) + (t.error_reason ? " · " + esc(t.error_reason) : "") + "</span></td><td>" + (t.tx_id ? (t.explorer ? '<a href="' + esc(t.explorer) + '" target="_blank" rel="noopener">' + esc(t.tx_id) + "</a>" : esc(t.tx_id)) : "-") + "</td></tr>").join("") || (cursor ? "" : '<tr><td colspan="6" class="muted">No transactions yet.</td></tr>'));
  cursor = d.cursor;
  $("more").hidden = !cursor;
}

$("env").onchange = $("days").onchange = $("status-filter").onchange = load;
$("more").onclick = more;
load();
</script>
</body>
</html>`;
