import type { VercelRequest, VercelResponse } from "@vercel/node";
import { issueToken, safeEqual } from "../_lib/auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return void res.status(405).json({ error: "Method not allowed" });
  const { username, password } = req.body ?? {};
  const u = process.env.ADMIN_USER || "admin";
  const p = process.env.ADMIN_PASSWORD;
  // So sánh cả hai để không lộ trường nào sai
  const okUser = safeEqual(String(username ?? ""), u);
  const okPass = !!p && safeEqual(String(password ?? ""), p);
  if (!okUser || !okPass) {
    await new Promise((r) => setTimeout(r, 600)); // làm chậm dò mật khẩu
    return void res.status(401).json({ error: "Sai tài khoản hoặc mật khẩu" });
  }
  res.json({ token: issueToken() });
}
