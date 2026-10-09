import type { VercelRequest, VercelResponse } from "@vercel/node";
import { endSession, safeEqual, startSession, totpEnabled, verifyTotp } from "../_lib/auth.js";
import { audit, safe } from "../_lib/guard.js";

/**
 * GET    -> { otp }       có yêu cầu mã 2FA không
 * POST   -> đăng nhập (đặt cookie HttpOnly)
 * DELETE -> đăng xuất; ?all=1 thu hồi mọi phiên
 */
async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET") return void res.json({ otp: totpEnabled() });

  if (req.method === "DELETE") {
    if (req.headers["x-requested-with"] !== "xoaykey") return void res.status(400).json({ error: "Bad request" });
    await endSession(req, res, req.query.all === "1");
    return void res.json({ ok: true });
  }
  if (req.method !== "POST") return void res.status(405).json({ error: "Method not allowed" });

  const { username, password, otp } = req.body ?? {};
  const u = process.env.ADMIN_USER || "admin";
  const p = process.env.ADMIN_PASSWORD;
  // Luôn chạy đủ cả ba kiểm tra để không lộ phần nào sai
  const okUser = safeEqual(String(username ?? ""), u);
  const okPass = !!p && p.length >= 12 && safeEqual(String(password ?? ""), p);
  const okOtp = totpEnabled() ? await verifyTotp(String(otp ?? "")) : true;
  if (!okUser || !okPass || !okOtp) {
    await audit(req, "login", false);
    await new Promise((r) => setTimeout(r, 600));
    return void res.status(401).json({ error: "Sai thông tin đăng nhập" });
  }
  await startSession(req, res);
  await audit(req, "login", true);
  res.json({ ok: true });
}

export default safe(handler);
