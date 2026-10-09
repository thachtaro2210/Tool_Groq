import { createHmac, timingSafeEqual } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const TTL_MS = 7 * 24 * 3600 * 1000;
const secret = () => process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || "";
const sign = (data: string) => createHmac("sha256", secret()).update(data).digest("base64url");

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Token phiên: base64url(hạn).chữ ký — không cần lưu DB. */
export function issueToken(): string {
  const body = Buffer.from(String(Date.now() + TTL_MS)).toString("base64url");
  return `${body}.${sign(body)}`;
}

function validToken(token: string): boolean {
  const [body, sig] = token.split(".");
  if (!body || !sig || !secret() || !safeEqual(sig, sign(body))) return false;
  return Number(Buffer.from(body, "base64url").toString()) > Date.now();
}

export function requireAdmin(req: VercelRequest, res: VercelResponse): boolean {
  if (!validToken(String(req.headers["x-admin-token"] ?? ""))) {
    res.status(401).json({ error: "Phiên đăng nhập hết hạn" });
    return false;
  }
  return true;
}

/** Token mà nền tảng của bạn dùng để xin key. */
export function requireToken(req: VercelRequest, res: VercelResponse): boolean {
  const t = process.env.PLATFORM_TOKEN;
  if (!t || !safeEqual(String(req.headers.authorization ?? ""), `Bearer ${t}`)) {
    res.status(401).json({ error: "Sai token" });
    return false;
  }
  return true;
}
