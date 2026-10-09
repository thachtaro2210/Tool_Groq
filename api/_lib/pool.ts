import { decrypt, keyHash } from "./crypto.js";
import { keysCol } from "./db.js";

const DEFAULT_COOLDOWN_SEC = 600;

/** Key hiện hành (đã giải mã): key sẵn sàng cũ nhất. Dùng đến khi bị báo hết thì mới chuyển key kế. */
export async function currentKey(): Promise<{ key: string } | null> {
  const col = await keysCol();
  const d = await col.findOneAndUpdate(
    { status: "active", cooldownUntil: { $lte: Date.now() } },
    { $set: { lastUsedAt: Date.now() }, $inc: { usageCount: 1 } },
    { sort: { createdAt: 1 } },
  );
  return d ? { key: decrypt(d.keyEnc) } : null;
}

/** Nền tảng báo key hết token (hoặc sai). exhausted -> nghỉ; invalid -> loại hẳn. */
export async function reportKey(
  key: string,
  reason: "exhausted" | "invalid",
  retryAfterSec?: number,
  msg = "",
) {
  const col = await keysCol();
  const sec = retryAfterSec && retryAfterSec > 0 ? Math.min(retryAfterSec, 7 * 86400) : DEFAULT_COOLDOWN_SEC;
  const set =
    reason === "invalid"
      ? { status: "invalid" as const, lastError: msg.slice(0, 300) }
      : { cooldownUntil: Date.now() + sec * 1000, lastError: msg.slice(0, 300) };
  await col.updateOne({ keyHash: keyHash(key) }, { $set: set, $inc: { failCount: 1 } });
}
