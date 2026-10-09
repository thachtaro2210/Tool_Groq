import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ObjectId } from "mongodb";
import { requireAdmin } from "../_lib/auth.js";
import { safe } from "../_lib/guard.js";
import { decrypt } from "../_lib/crypto.js";
import { keysCol } from "../_lib/db.js";
import { probeKey } from "../_lib/groq.js";

/**
 * POST /api/admin/check { key }  -> kiểm tra key thô (chưa lưu), không ghi DB
 * POST /api/admin/check { id }   -> kiểm tra key đã lưu, lưu kết quả vào DB
 */
async function handler(req: VercelRequest, res: VercelResponse) {
  if (!(await requireAdmin(req, res))) return;
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return void res.status(405).json({ error: "Method not allowed" });

  const { key, id } = req.body ?? {};
  if (key) {
    const k = String(key).trim();
    if (!/^gsk_[A-Za-z0-9]{20,200}$/.test(k)) return void res.status(400).json({ error: "Key sai định dạng (gsk_...)" });
    return void res.json(await probeKey(k));
  }

  if (!ObjectId.isValid(String(id))) return void res.status(400).json({ error: "id không hợp lệ" });
  const col = await keysCol();
  const _id = new ObjectId(String(id));
  const doc = await col.findOne({ _id });
  if (!doc) return void res.status(404).json({ error: "Không tìm thấy key" });

  const check = await probeKey(decrypt(doc.keyEnc));
  const set: Record<string, unknown> = { check };
  if (!check.ok && check.error?.startsWith("Key không hợp lệ")) set.status = "invalid";
  else if (check.limited) set.cooldownUntil = Date.now() + 10 * 60_000;
  await col.updateOne({ _id }, { $set: set });
  res.json(check);
}

export default safe(handler);
