import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ObjectId } from "mongodb";
import { requireAdmin } from "../_lib/auth.js";
import { keysCol } from "../_lib/db.js";

const mask = (k: string) => `${k.slice(0, 8)}...${k.slice(-4)}`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAdmin(req, res)) return;
  const col = await keysCol();

  if (req.method === "GET") {
    const docs = await col.find().sort({ createdAt: -1 }).toArray();
    return void res.json(docs.map((d) => ({ ...d, _id: d._id.toString(), key: mask(d.key) })));
  }

  if (req.method === "POST") {
    const raw: string[] = req.body?.keys ?? [];
    const checks: Record<string, unknown> = req.body?.checks ?? {}; // kết quả kiểm tra kèm theo (nếu có)
    const keys = [...new Set(raw.map((s) => s.trim()).filter(Boolean))];
    if (!keys.length) return void res.status(400).json({ error: "Không có key" });
    const now = Date.now();
    const r = await col.bulkWrite(
      keys.map((key) => ({
        updateOne: {
          filter: { key },
          update: {
            $setOnInsert: {
              key, status: "active" as const, cooldownUntil: 0, usageCount: 0,
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
    const set =
      action === "disable" ? { status: "disabled" as const }
      : action === "enable" || action === "reset"
        ? { status: "active" as const, cooldownUntil: 0, lastError: "" }
        : null;
    if (!set) return void res.status(400).json({ error: "action không hợp lệ" });
    await col.updateOne({ _id: new ObjectId(String(id)) }, { $set: set });
    return void res.json({ ok: true });
  }

  if (req.method === "DELETE") {
    await col.deleteOne({ _id: new ObjectId(String(req.query.id)) });
    return void res.json({ ok: true });
  }

  res.status(405).json({ error: "Method not allowed" });
}
