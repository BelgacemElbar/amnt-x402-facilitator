import {
  PrivateKey,
  Transaction,
  TransferTransaction,
  createHederaClient,
  createHederaPreflightTransfer,
  createHederaVerifyPayerSignature,
  mirrorNodeUrlForNetwork,
} from "@x402/hedera";

// Always use the PrivateKey/Client re-exported by @x402/hedera. Mixing in a
// separately installed @hiero-ledger/sdk or @hashgraph/sdk breaks the package's
// internal instanceof checks at runtime.

type KeyType = "ED25519" | "ECDSA_SECP256K1";

/**
 * The fee-payer signer: co-signs and submits payer-signed x402 transfers.
 *
 * Async because the key type is READ from the ledger, never guessed. A bare
 * 64-char hex string is a valid ED25519 seed AND a valid ECDSA scalar, so a
 * guess can return a perfectly good key for a different account. Every
 * settlement then dies with INVALID_SIGNATURE, which reads like a buyer fault.
 * Here a wrong key stops startup with one clear sentence instead.
 */
export async function createHederaFeePayer(accountId: string, rawKey: string, network: string) {
  const onChain = await accountKey(accountId, network);
  const key = parseHederaKey(rawKey, onChain?.type);
  if (onChain?.publicKey) {
    const derived = [key.publicKey.toStringRaw(), key.publicKey.toStringDer()].map((s) => s.toLowerCase());
    if (!derived.includes(onChain.publicKey.toLowerCase())) {
      throw new Error(
        `HEDERA_FACILITATOR_KEY does not control ${accountId}: the ledger holds a different ${onChain.type} key. Every settlement would fail INVALID_SIGNATURE.`,
      );
    }
  }

  return {
    getAddresses: () => [accountId],
    signAndSubmitTransaction: async (transactionBase64: string, _feePayer: string, net: string) => {
      const tx = Transaction.fromBytes(Buffer.from(transactionBase64, "base64"));
      if (!(tx instanceof TransferTransaction)) throw new Error("expected TransferTransaction");
      const signed = await tx.sign(key);
      const client = clientFor(net);
      const response = await signed.execute(client);
      await response.getReceipt(client);
      return { transactionId: response.transactionId.toString() };
    },
    verifyPayerSignature: createHederaVerifyPayerSignature(),
    preflightTransfer: createHederaPreflightTransfer(),
  };
}

/**
 * One Hedera client per network for the life of the process. The SDK's
 * default builds and closes a client per settlement, paying for new gRPC
 * channels every time: a settle took 16 s against a 1.3 s verify.
 */
const clients = new Map<string, any>();
function clientFor(network: string) {
  let client = clients.get(network);
  if (!client) {
    client = createHederaClient(network as any);
    clients.set(network, client);
  }
  return client;
}

export async function hederaBalance(accountId: string, network: string): Promise<number | null> {
  try {
    const res = await fetch(`${mirrorNodeUrlForNetwork(network as any)}/api/v1/accounts/${accountId}`, { signal: AbortSignal.timeout(6000) });
    return res.ok ? Number(((await res.json()) as any)?.balance?.balance ?? 0) / 1e8 : null;
  } catch {
    return null;
  }
}

/** The account's key type and public key from the mirror node. Null when unknown on this network. */
async function accountKey(accountId: string, network: string): Promise<{ type: KeyType; publicKey: string } | null> {
  try {
    // Bounded: a fetch that never settles never rejects, so try/catch alone can't save you.
    const res = await fetch(`${mirrorNodeUrlForNetwork(network as any)}/api/v1/accounts/${accountId}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data: any = await res.json();
    const t = data?.key?._type;
    if (t !== "ED25519" && t !== "ECDSA_SECP256K1") return null;
    return { type: t, publicKey: String(data.key.key || "") };
  } catch {
    return null;
  }
}

/** DER carries its algorithm, so it is the only safe guess when the ledger didn't say. */
export function parseHederaKey(raw: string, expectedType?: KeyType) {
  const trimmed = raw.trim().replace(/^0x/, "");
  if (expectedType === "ED25519") return PrivateKey.fromStringED25519(trimmed);
  if (expectedType === "ECDSA_SECP256K1") return PrivateKey.fromStringECDSA(trimmed);
  try {
    return PrivateKey.fromStringDer(trimmed);
  } catch {
    return PrivateKey.fromString(trimmed);
  }
}
