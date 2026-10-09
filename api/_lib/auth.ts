import { createHmac, randomBytes } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { safeEqual, sha256 } from "./crypto.js";
import { sessionsCol } from "./db.js";
import { audit, clientIp, hit, peek } from "./guard.js";

export { safeEqual };

const SESSION_SEC = 12 * 3600;
const COOKIE = "sid";

const isLocal = (req: VercelRequest) => /^(localhost|127\.0\.0\.1)(:|$)/.test(String(req.headers.host ?? ""));
const cookieOf = (req: VercelRequest, name: string) =>
  String(req.headers.cookie ?? "").split(/;\s*/).map((c) => c.split("=")).find(([k]) => k === name)?.[1] ?? "";

function setCookie(req: VercelRequest, res: VercelResponse, value: string, maxAge: number) {
  res.setHeader("Set-Cookie", `${COOKIE}=${value}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isLocal(req) ? "" : "; Secure"}`);
}

/** Phiên lưu trong DB (token ngẫu nhiên, chỉ lưu hash) -> thu hồi được, hết hạn tự xoá. */
export async function startSession(req: VercelRequest, res: VercelResponse) {
  const token = randomBytes(32).toString("base64url");
  await (await sessionsCol()).insertOne({
    _id: sha256(token), ip: clientIp(req), ua: String(req.headers["user-agent"] ?? "").slice(0, 200),
    createdAt: Date.now(), expireAt: new Date(Date.now() + SESSION_SEC * 1000),
  });
  setCookie(req, res, token, SESSION_SEC);
}

export async function endSession(req: VercelRequest, res: VercelResponse, all = false) {
  const col = await sessionsCol();
  const t = cookieOf(req, COOKIE);
  if (all) await col.deleteMany({});
  else if (t) await col.deleteOne({ _id: sha256(t) });
  setCookie(req, res, "", 0);
}

/** Cần cookie phiên hợp lệ + header tự đặt (chặn CSRF thêm một lớp ngoài SameSite). */
export async function requireAdmin(req: VercelRequest, res: VercelResponse): Promise<boolean> {
  const t = cookieOf(req, COOKIE);
  const s = t && req.headers["x-requested-with"] === "xoaykey"
    ? await (await sessionsCol()).findOne({ _id: sha256(t), expireAt: { $gt: new Date() } })
    : null;
  if (!s) {
    res.status(401).json({ error: "Phiên đăng nhập hết hạn" });
    return false;
  }
  if ((await hit(`adm:${s._id}`, 60)) > 120) {
    res.status(429).json({ error: "Thao tác quá nhanh, thử lại sau" });
    return false;
  }
  return true;
}

/** Token mà nền tảng của bạn dùng để xin key. Giới hạn tần suất, khoá IP khi dò sai, tuỳ chọn allowlist IP. */
export async function requireToken(req: VercelRequest, res: VercelResponse): Promise<boolean> {
  const ip = clientIp(req);
  const deny = async (code: number, error: string, note: string) => {
    await audit(req, "key", false, note);
    res.status(code).json({ error });
    return false;
  };
  if (await peek(`pf:${ip}`, 600) >= 10) return deny(429, "Bị khoá tạm thời do sai token nhiều lần", "locked");

  const allow = (process.env.PLATFORM_ALLOWED_IPS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allow.length && !allow.includes(ip)) return deny(403, "IP không được phép", "ip-not-allowed");

  const t = process.env.PLATFORM_TOKEN;
  if (!t || t.length < 24 || !safeEqual(String(req.headers.authorization ?? ""), `Bearer ${t}`)) {
    await hit(`pf:${ip}`, 600);
    return deny(401, "Sai token", "bad-token");
  }
  if ((await hit(`pk:${ip}`, 60)) > 60) return deny(429, "Quá nhiều yêu cầu", "rate");
  return true;
}

/* ---------- TOTP (RFC 6238), bật khi có ADMIN_TOTP_SECRET (base32) ---------- */
export const totpEnabled = () => !!process.env.ADMIN_TOTP_SECRET;

function base32(s: string): Buffer {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of s.replace(/[\s=]/g, "").toUpperCase()) bits += A.indexOf(c).toString(2).padStart(5, "0");
  return Buffer.from(bits.match(/.{8}/g)?.map((b) => parseInt(b, 2)) ?? []);
}
function totpAt(step: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", base32(process.env.ADMIN_TOTP_SECRET ?? "")).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
/** Đúng mã (±30s) và chưa dùng lại. */
export async function verifyTotp(code: string): Promise<boolean> {
  const c = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return false;
  const step = Math.floor(Date.now() / 30000);
  const okStep = [-1, 0, 1].find((d) => safeEqual(totpAt(step + d), c));
  return okStep !== undefined && (await hit(`otp:${c}`, 120)) === 1;
}
