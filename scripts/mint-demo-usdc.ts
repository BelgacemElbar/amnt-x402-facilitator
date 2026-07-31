import "dotenv/config";
import {
  AccountId,
  Client,
  PrivateKey,
  TokenCreateTransaction,
  TokenType,
  TokenSupplyType,
  TokenAssociateTransaction,
  TransferTransaction,
} from "@hiero-ledger/sdk";

// Mints a demo-only HTS fungible token that mirrors real USDC's shape
// (6 decimals) so the facilitator's HTS settlement path can be demoed
// without depending on Circle's separate testnet USDC faucet. Treasury is
// the facilitator's own account; supply is minted straight to the demo
// agent so it can pay with it immediately.

async function main() {
  const client = Client.forTestnet().setOperator(
    AccountId.fromString(process.env.HEDERA_FACILITATOR_ID!),
    PrivateKey.fromStringECDSA(process.env.HEDERA_FACILITATOR_KEY!),
  );
  const treasuryKey = PrivateKey.fromStringECDSA(process.env.HEDERA_FACILITATOR_KEY!);

  const createReceipt = await (
    await new TokenCreateTransaction()
      .setTokenName("Demo USD Coin")
      .setTokenSymbol("tUSDC")
      .setTokenType(TokenType.FungibleCommon)
      .setDecimals(6)
      .setInitialSupply(1_000_000_000) // 1,000 tUSDC
      .setTreasuryAccountId(AccountId.fromString(process.env.HEDERA_FACILITATOR_ID!))
      .setSupplyType(TokenSupplyType.Infinite)
      .setSupplyKey(treasuryKey.publicKey)
      .freezeWith(client)
      .sign(treasuryKey)
  )
    .execute(client)
    .then((tx) => tx.getReceipt(client));

  const tokenId = createReceipt.tokenId!.toString();
  console.log("DEMO_USDC_TOKEN_ID=" + tokenId);

  const agentId = AccountId.fromString(process.env.DEMO_AGENT_ID!);
  const agentKey = PrivateKey.fromStringECDSA(process.env.DEMO_AGENT_KEY!);
  const merchantId = AccountId.fromString(process.env.DEMO_MERCHANT_ID!);
  const merchantKey = PrivateKey.fromStringECDSA(process.env.DEMO_MERCHANT_KEY!);

  await (
    await new TokenAssociateTransaction()
      .setAccountId(agentId)
      .setTokenIds([createReceipt.tokenId!])
      .freezeWith(client)
      .sign(agentKey)
  )
    .execute(client)
    .then((tx) => tx.getReceipt(client));

  await (
    await new TokenAssociateTransaction()
      .setAccountId(merchantId)
      .setTokenIds([createReceipt.tokenId!])
      .freezeWith(client)
      .sign(merchantKey)
  )
    .execute(client)
    .then((tx) => tx.getReceipt(client));

  await (
    await new TransferTransaction()
      .addTokenTransfer(createReceipt.tokenId!, AccountId.fromString(process.env.HEDERA_FACILITATOR_ID!), -100_000_000)
      .addTokenTransfer(createReceipt.tokenId!, agentId, 100_000_000) // 100 tUSDC to the demo agent
      .freezeWith(client)
      .sign(treasuryKey)
  )
    .execute(client)
    .then((tx) => tx.getReceipt(client));

  console.log("Associated agent + merchant, funded agent with 100 tUSDC.");
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
