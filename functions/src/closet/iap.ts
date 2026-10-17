/**
 * Buying Bucks (plan phase 4). STUB: not live.
 *
 * - The default verifier refuses everything (`iap_not_configured`). A real
 *   App Store Server API / Play Developer API verifier plugs in later.
 * - Even with a verifier, only sandbox receipts are credited (`iap_not_live`
 *   otherwise), so nothing here can take real money by accident.
 * - Credits go to the bought bucket with a ledger id per store transaction,
 *   so a replayed receipt is a no-op. Refunds claw back bought Bucks.
 */
import { ClosetError, isId, paths, type ClosetActor } from "./model.js";
import type { ClosetDb } from "./store.js";
import { clawback, credit, ledgerExists, readWallet } from "./wallet.js";

export type IapPlatform = "ios" | "android";

export interface VerifiedReceipt {
  transactionId: string;
  productId: string;
  sandbox: boolean;
}

export interface ReceiptVerifier {
  verify(platform: IapPlatform, receipt: string): Promise<VerifiedReceipt>;
}

/** Placeholder product ids until the store listings exist. */
export const BUCKS_PRODUCTS: Readonly<Record<string, number>> = {
  "com.skatehubba.bucks.500": 500,
  "com.skatehubba.bucks.1200": 1200,
  "com.skatehubba.bucks.2500": 2500,
};

export const unconfiguredVerifier: ReceiptVerifier = {
  async verify() {
    throw new ClosetError("iap_not_configured");
  },
};

export interface IapResult {
  credited: number;
  balance: number;
  duplicate: boolean;
}

function platformOf(value: unknown): IapPlatform {
  if (value === "ios" || value === "android") return value;
  throw new ClosetError("bad_request");
}

const ledgerId = (platform: IapPlatform, transactionId: string) => `iap_${platform}_${transactionId}`;

export async function iapVerify(
  db: ClosetDb,
  actor: ClosetActor,
  input: { platform: unknown; receipt: unknown },
  verifier: ReceiptVerifier,
): Promise<IapResult> {
  const platform = platformOf(input.platform);
  const receipt = input.receipt;
  if (typeof receipt !== "string" || receipt.length === 0 || receipt.length > 100_000) {
    throw new ClosetError("bad_request");
  }
  const verified = await verifier.verify(platform, receipt);
  if (!verified.sandbox) throw new ClosetError("iap_not_live");
  const amount = BUCKS_PRODUCTS[verified.productId];
  if (amount === undefined) throw new ClosetError("unknown_product");
  if (!isId(verified.transactionId)) throw new ClosetError("bad_receipt");
  const txId = ledgerId(platform, verified.transactionId);
  return db.runTransaction(async (tx) => {
    const wallet = await readWallet(tx, actor.uid);
    if (await ledgerExists(tx, actor.uid, txId)) return { credited: 0, balance: wallet.balance, duplicate: true };
    const note = { reason: "iap", ref: verified.productId };
    const next = credit(tx, actor.uid, wallet, amount, "bought", note, txId, actor.nowMs);
    return { credited: amount, balance: next.balance, duplicate: false };
  });
}

/** Refund notification → claw back the bought Bucks. May leave a negative balance. */
export async function iapRefund(
  db: ClosetDb,
  uid: string,
  platform: unknown,
  transactionId: unknown,
  nowMs: number,
): Promise<{ clawedBack: number; balance: number }> {
  const p = platformOf(platform);
  if (!isId(transactionId)) throw new ClosetError("bad_request");
  const original = ledgerId(p, transactionId);
  return db.runTransaction(async (tx) => {
    const row = (await tx.get(paths.ledger(uid, original))).data;
    if (!row) throw new ClosetError("not_found");
    const wallet = await readWallet(tx, uid);
    if (await ledgerExists(tx, uid, `${original}_refund`)) return { clawedBack: 0, balance: wallet.balance };
    const amount = typeof row.bought === "number" ? row.bought : 0;
    if (amount <= 0) throw new ClosetError("bad_receipt");
    const next = clawback(
      tx,
      uid,
      wallet,
      amount,
      { reason: "iap_refund", ref: transactionId },
      `${original}_refund`,
      nowMs,
    );
    return { clawedBack: amount, balance: next.balance };
  });
}
