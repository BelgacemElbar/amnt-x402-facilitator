import "dotenv/config";
import { AccountId, Client, Hbar, PrivateKey, AccountCreateTransaction } from "@hiero-ledger/sdk";

async function main() {
  const client = Client.forTestnet().setOperator(
    AccountId.fromString(process.env.HEDERA_FACILITATOR_ID!),
    PrivateKey.fromStringECDSA(process.env.HEDERA_FACILITATOR_KEY!),
  );
  const newKey = PrivateKey.generateECDSA();
  const receipt = await (
    await new AccountCreateTransaction().setKeyWithoutAlias(newKey.publicKey).setInitialBalance(new Hbar(50)).execute(client)
  ).getReceipt(client);

  console.log("PAYER_ACCOUNT_ID=" + receipt.accountId!.toString());
  console.log("PAYER_PRIVATE_KEY=" + newKey.toStringDer());
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
