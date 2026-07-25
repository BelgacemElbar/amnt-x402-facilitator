import {
  PrivateKey,
  createHederaClient,
  createHederaPreflightTransfer,
  createHederaSignAndSubmitTransaction,
  createHederaVerifyPayerSignature,
  type FacilitatorHederaSigner,
} from "@x402/hedera";

// Always import PrivateKey/Client from @x402/hedera (pinned to its own
// @hiero-ledger/sdk install) rather than a separately-installed
// @hiero-ledger/sdk or @hashgraph/sdk — mixing SDK instances breaks the
// package's internal instanceof checks at runtime. See @x402/hedera's README.

/**
 * Builds the facilitator-side Hedera signer: the fee-payer account that
 * co-signs and submits payer-signed x402 transfers. Signature verification
 * and preflight balance/association checks are delegated to the SDK's
 * default Mirror Node-backed implementations — no extra infra needed.
 */
export function createFacilitatorSigner(accountId: string, privateKeyStr: string): FacilitatorHederaSigner {
  const privateKey = parseHederaPrivateKey(privateKeyStr);

  return {
    getAddresses: () => [accountId],
    signAndSubmitTransaction: createHederaSignAndSubmitTransaction(
      (network) => createHederaClient(network),
      privateKey,
    ),
    verifyPayerSignature: createHederaVerifyPayerSignature(),
    preflightTransfer: createHederaPreflightTransfer(),
  };
}

/**
 * Parses a Hedera private key from any common string encoding.
 *
 * Tries ECDSA/ED25519 first, not DER: `fromStringDer` can silently
 * mis-parse a raw (non-DER-prefixed) hex key into the wrong key material
 * instead of throwing, which produces a signer that looks valid but signs
 * with the wrong bytes. Confirmed against a real testnet account while
 * building this facilitator — the Hedera SDK's own runtime warning says
 * the same thing: prefer fromStringECDSA/fromStringED25519 for hex,
 * fromStringDer only for actual DER-prefixed hex.
 */
export function parseHederaPrivateKey(raw: string): PrivateKey {
  try {
    return PrivateKey.fromStringECDSA(raw);
  } catch {
    try {
      return PrivateKey.fromStringDer(raw);
    } catch {
      return PrivateKey.fromString(raw);
    }
  }
}
