import { x402Facilitator } from "@x402/core/facilitator";
import { ExactHederaScheme } from "@x402/hedera/exact/facilitator";
import { ExactEvmScheme } from "@x402/evm/exact/facilitator";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { ExactSvmScheme } from "@x402/svm/exact/facilitator";
import { toFacilitatorSvmSigner, SOLANA_MAINNET_CAIP2, SOLANA_DEVNET_CAIP2, MAINNET_RPC_URL, DEVNET_RPC_URL } from "@x402/svm";
import { createKeyPairSignerFromBytes, getBase58Encoder, createSolanaRpc, address } from "@solana/kit";
import { createWalletClient, http, publicActions, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import * as viemChains from "viem/chains";
import { createHederaFeePayer, hederaBalance } from "./hedera.js";

/** One fee payer this instance settles with. `balance` never throws: null means unknown. */
export type FeePayer = {
  network: string;
  address: string;
  unit: "HBAR" | "ETH" | "SOL";
  /** Below this, settlements are at risk. */
  lowAt: number;
  balance: () => Promise<number | null>;
};

type Env = Record<string, string | undefined>;

const EVM_CHAINS = (Object.values(viemChains) as unknown[]).filter((c): c is Chain => typeof c === "object" && c !== null && "id" in c);

/**
 * Register every chain that has a key and return its fee payers.
 *
 * A chain is ON when its key is set. That is the whole switch.
 * Throws when a key is set but wrong: a resource server reads /supported once
 * and trusts it, so a half-working facilitator is worse than a clear error.
 */
export async function registerChains(facilitator: x402Facilitator, env: Env = process.env): Promise<FeePayer[]> {
  const get = (name: string) => (env[name] || "").trim();
  const payers: FeePayer[] = [];

  // ── Hedera ────────────────────────────────────────────────────────────────
  if (get("HEDERA_FACILITATOR_ID") && get("HEDERA_FACILITATOR_KEY")) {
    const id = get("HEDERA_FACILITATOR_ID");
    // HEDERA_FACILITATOR_NETWORK is the v0.x name, still honoured.
    const network = get("HEDERA_NETWORK") || get("HEDERA_FACILITATOR_NETWORK") || "hedera:testnet";
    const signer = await createHederaFeePayer(id, get("HEDERA_FACILITATOR_KEY"), network);
    facilitator.register(network as any, new ExactHederaScheme(signer as any));
    payers.push({ network, address: id, unit: "HBAR", lowAt: 5, balance: () => hederaBalance(id, network) });
  }

  // ── EVM ───────────────────────────────────────────────────────────────────
  if (get("EVM_FACILITATOR_KEY")) {
    const key = get("EVM_FACILITATOR_KEY");
    const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`);
    const networks = (get("EVM_NETWORKS") || "eip155:84532").split(",").map((n) => n.trim()).filter(Boolean);
    for (const network of networks) {
      const id = Number(network.split(":")[1]);
      const chain = EVM_CHAINS.find((c) => c.id === id);
      if (!chain) throw new Error(`EVM_NETWORKS: ${network} is not a chain viem knows.`);
      const rpc = get(`EVM_RPC_URL_${id}`) || undefined;
      const client = createWalletClient({ account, chain, transport: http(rpc) }).extend(publicActions);
      facilitator.register(network as any, new ExactEvmScheme(toFacilitatorEvmSigner({ ...client, address: account.address } as any)));
      payers.push({
        network, address: account.address, unit: "ETH", lowAt: 0.0005,
        balance: async () => {
          try {
            return Number(await client.getBalance({ address: account.address })) / 1e18;
          } catch {
            return null;
          }
        },
      });
    }
  }

  // ── Solana ────────────────────────────────────────────────────────────────
  if (get("SOLANA_FACILITATOR_KEY")) {
    const mainnet = (get("SOLANA_NETWORK") || "devnet") === "mainnet" || get("SOLANA_NETWORK") === SOLANA_MAINNET_CAIP2;
    const network = mainnet ? SOLANA_MAINNET_CAIP2 : SOLANA_DEVNET_CAIP2;
    const rpcUrl = get("SOLANA_RPC_URL") || (mainnet ? MAINNET_RPC_URL : DEVNET_RPC_URL);
    const raw = get("SOLANA_FACILITATOR_KEY");
    const bytes = raw.startsWith("[") ? Uint8Array.from(JSON.parse(raw)) : getBase58Encoder().encode(raw);
    const keypair = await createKeyPairSignerFromBytes(bytes as Uint8Array);
    facilitator.register(network as any, new ExactSvmScheme(toFacilitatorSvmSigner(keypair, { defaultRpcUrl: rpcUrl } as any)));
    const rpc = createSolanaRpc(rpcUrl);
    payers.push({
      network, address: keypair.address, unit: "SOL", lowAt: 0.01,
      balance: async () => {
        try {
          const { value } = await rpc.getBalance(address(keypair.address)).send();
          return Number(value) / 1e9;
        } catch {
          return null;
        }
      },
    });
  }

  if (!payers.length) {
    throw new Error("No chains configured. Set HEDERA_FACILITATOR_ID + HEDERA_FACILITATOR_KEY, EVM_FACILITATOR_KEY or SOLANA_FACILITATOR_KEY.");
  }
  return payers;
}

export const envOf = (network: string) => (/testnet|devnet|sepolia|amoy|fuji|EtWTRAB|84532|80002/i.test(network || "") ? "testnet" : "mainnet");

/** Block explorer page for a settlement, when we know one. */
export function explorerUrl(network: string, tx: string | null): string | null {
  if (!tx) return null;
  if (network.startsWith("hedera:")) return `https://hashscan.io/${network.split(":")[1]}/transaction/${tx}`;
  if (network === SOLANA_MAINNET_CAIP2) return `https://solscan.io/tx/${tx}`;
  if (network === SOLANA_DEVNET_CAIP2) return `https://solscan.io/tx/${tx}?cluster=devnet`;
  if (network.startsWith("eip155:")) {
    const chain = EVM_CHAINS.find((c) => c.id === Number(network.split(":")[1]));
    const base = chain?.blockExplorers?.default?.url;
    return base ? `${base}/tx/${tx}` : null;
  }
  return null;
}
