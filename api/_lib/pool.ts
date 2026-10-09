import { keysCol, type KeyDoc } from "./db.js";

const DEFAULT_COOLDOWN_SEC = 600;

/** Key hiện hành: key sẵn sàng cũ nhất. Dùng đến khi bị báo hết thì mới chuyển key kế. */
export async function currentKey(): Promise<KeyDoc | null> {
  const col = await keysCol();
  return col.findOneAndUpdate(
    { status: "active", cooldownUntil: { $lte: Date.now() } },
    { $set: { lastUsedAt: Date.now() }, $inc: { usageCount: 1 } },
    { sort: { createdAt: 1 } },
  );
}

/** Nền tảng báo key hết token (hoặc sai). exhausted -> nghỉ; invalid -> loại hẳn. */
export async function reportKey(
  key: string,
  reason: "exhausted" | "invalid",
  retryAfterSec?: number,
  msg = "",
) {
  const col = await keysCol();
  const sec = retryAfterSec && retryAfterSec > 0 ? retryAfterSec : DEFAULT_COOLDOWN_SEC;
  const set =
    reason === "invalid"
      ? { status: "invalid" as const, lastError: msg.slice(0, 300) }
      : { cooldownUntil: Date.now() + sec * 1000, lastError: msg.slice(0, 300) };
  await col.updateOne({ key }, { $set: set, $inc: { failCount: 1 } });
}
