import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

function master(): Buffer {
  const s = process.env.KEY_ENCRYPTION_SECRET ?? "";
  if (s.length < 32) throw new Error("KEY_ENCRYPTION_SECRET phải có ít nhất 32 ký tự");
  return Buffer.from(s);
}
const derive = (info: string) => Buffer.from(hkdfSync("sha256", master(), "xoaykey", info, 32));

/** AES-256-GCM: base64url(iv).base64url(tag).base64url(ciphertext) */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", derive("enc"), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(blob: string): string {
  const [iv, tag, ct] = blob.split(".").map((p) => Buffer.from(p, "base64url"));
  const d = createDecipheriv("aes-256-gcm", derive("enc"), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}

/** Dấu vân tay có khoá của key (để tra cứu/unique mà không lưu key thô). */
export const keyHash = (key: string) => createHmac("sha256", derive("idx")).update(key).digest("hex");

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** So sánh hằng thời gian, không lộ độ dài (so sánh qua hash). */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}
