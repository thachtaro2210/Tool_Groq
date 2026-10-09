import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ObjectId } from "mongodb";
import { requireAdmin } from "../_lib/auth.js";
import { keysCol } from "../_lib/db.js";
import { probeKey } from "../_lib/groq.js";

/**
 * POST /api/admin/check { key }  -> kiểm tra key thô (chưa lưu), không ghi DB
 * POST /api/admin/check { id }   -> kiểm tra key đã lưu, lưu kết quả vào DB
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== "POST") return void res.status(405).json({ error: "Method not allowed" });

  const { key, id } = req.body ?? {};
  if (key) return void res.json(await probeKey(String(key).trim()));

  const col = await keysCol();
  const _id = new ObjectId(String(id));
  const doc = await col.findOne({ _id });
  if (!doc) return void res.status(404).json({ error: "Không tìm thấy key" });

  const check = await probeKey(doc.key);
  const set: Record<string, unknown> = { check };
  if (!check.ok && check.error?.startsWith("Key không hợp lệ")) set.status = "invalid";
  else if (check.limited) set.cooldownUntil = Date.now() + 10 * 60_000;
  await col.updateOne({ _id }, { $set: set });
  res.json(check);
}
