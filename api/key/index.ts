import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireToken } from "../_lib/auth.js";
import { currentKey, reportKey } from "../_lib/pool.js";

/**
 * GET  /api/key                         -> { key }
 * POST /api/key  { failedKey, reason?, retryAfter?, message? } -> báo key hỏng + trả key mới { key }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireToken(req, res)) return;

  if (req.method === "POST") {
    const { failedKey, reason, retryAfter, message } = req.body ?? {};
    if (failedKey) {
      await reportKey(
        String(failedKey),
        reason === "invalid" ? "invalid" : "exhausted",
        Number(retryAfter) || undefined,
        String(message ?? ""),
      );
    }
  } else if (req.method !== "GET") {
    return void res.status(405).json({ error: "Method not allowed" });
  }

  const k = await currentKey();
  if (!k) return void res.status(503).json({ error: "Hết key khả dụng, hãy thêm key mới" });
  res.setHeader("Cache-Control", "no-store");
  res.json({ key: k.key });
}
