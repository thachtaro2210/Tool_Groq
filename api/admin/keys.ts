import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ObjectId } from "mongodb";
import { requireAdmin } from "../_lib/auth.js";
import { safe } from "../_lib/guard.js";
import { decrypt, encrypt, keyHash } from "../_lib/crypto.js";
import { keysCol, maskKey } from "../_lib/db.js";

const GROQ_KEY = /^gsk_[A-Za-z0-9]{20,200}$/;
const oid = (v: unknown) => (ObjectId.isValid(String(v)) ? new ObjectId(String(v)) : null);

async function handler(req: VercelRequest, res: VercelResponse) {
  if (!(await requireAdmin(req, res))) return;
  res.setHeader("Cache-Control", "no-store");
  const col = await keysCol();

  if (req.method === "GET") {
    const docs = await col.find().sort({ createdAt: -1 }).toArray();
    return void res.json(
      docs.map(({ keyEnc, keyHash: _h, keyMask: _m, ...d }) => ({ ...d, _id: d._id.toString(), key: decrypt(keyEnc) })),
    );
  }

  if (req.method === "POST") {
    const raw: unknown[] = Array.isArray(req.body?.keys) ? req.body.keys : [];
    const checks: Record<string, unknown> = req.body?.checks ?? {}; // kết quả kiểm tra kèm theo (nếu có)
    const keys = [...new Set(raw.map((s) => String(s).trim()).filter(Boolean))].slice(0, 100);
    if (!keys.length) return void res.status(400).json({ error: "Không có key" });
    if (keys.some((k) => !GROQ_KEY.test(k))) return void res.status(400).json({ error: "Có key sai định dạng (gsk_...)" });
    const now = Date.now();
    const r = await col.bulkWrite(
      keys.map((key) => ({
        updateOne: {
          filter: { keyHash: keyHash(key) },
          update: {
            $setOnInsert: {
              keyHash: keyHash(key), keyEnc: encrypt(key), keyMask: maskKey(key),
              status: "active" as const, cooldownUntil: 0, usageCount: 0,
              failCount: 0, lastUsedAt: 0, createdAt: now,
              ...(checks[key] ? { check: checks[key] as never } : {}),
            },
          },
          upsert: true,
        },
      })),
    );
    return void res.json({ added: r.upsertedCount, duplicated: keys.length - r.upsertedCount });
  }

  if (req.method === "PATCH") {
    const { id, action } = req.body ?? {};
    const _id = oid(id);
    if (!_id) return void res.status(400).json({ error: "id không hợp lệ" });
    const set =
      action === "disable" ? { status: "disabled" as const }
      : action === "enable" || action === "reset"
        ? { status: "active" as const, cooldownUntil: 0, lastError: "" }
        : null;
    if (!set) return void res.status(400).json({ error: "action không hợp lệ" });
    await col.updateOne({ _id }, { $set: set });
    return void res.json({ ok: true });
  }

  if (req.method === "DELETE") {
    const _id = oid(req.query.id);
    if (!_id) return void res.status(400).json({ error: "id không hợp lệ" });
    await col.deleteOne({ _id });
    return void res.json({ ok: true });
  }

  res.status(405).json({ error: "Method not allowed" });
}

export default safe(handler);
