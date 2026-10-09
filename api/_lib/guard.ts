import type { VercelRequest } from "@vercel/node";
import { auditCol, rateCol } from "./db.js";

export function clientIp(req: VercelRequest): string {
  const h = (n: string) => String(req.headers[n] ?? "").split(",")[0].trim();
  return h("x-vercel-forwarded-for") || h("x-real-ip") || h("x-forwarded-for") || req.socket?.remoteAddress || "unknown";
}

/** Đếm lượt trong cửa sổ cố định. Trả về số lượt sau khi tăng. */
export async function hit(bucket: string, windowSec: number): Promise<number> {
  const col = await rateCol();
  const slot = Math.floor(Date.now() / (windowSec * 1000));
  const r = await col.findOneAndUpdate(
    { _id: `${bucket}:${slot}` },
    { $inc: { n: 1 }, $setOnInsert: { expireAt: new Date((slot + 1) * windowSec * 1000 + 60_000) } },
    { upsert: true, returnDocument: "after" },
  );
  return r?.n ?? 1;
}

export async function peek(bucket: string, windowSec: number): Promise<number> {
  const col = await rateCol();
  const slot = Math.floor(Date.now() / (windowSec * 1000));
  return (await col.findOne({ _id: `${bucket}:${slot}` }))?.n ?? 0;
}

export async function audit(req: VercelRequest, type: string, ok: boolean, note?: string) {
  try {
    await (await auditCol()).insertOne({
      at: new Date(), type, ip: clientIp(req), ok, ua: String(req.headers["user-agent"] ?? "").slice(0, 200), note,
    });
  } catch { /* log không được làm hỏng request */ }
}
