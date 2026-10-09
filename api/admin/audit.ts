import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../_lib/auth.js";
import { auditCol } from "../_lib/db.js";

/** 100 sự kiện gần nhất: đăng nhập, lấy key (cả thất bại). Tự xoá sau 30 ngày. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!(await requireAdmin(req, res))) return;
  if (req.method !== "GET") return void res.status(405).json({ error: "Method not allowed" });
  res.json(await (await auditCol()).find({}, { projection: { _id: 0 } }).sort({ at: -1 }).limit(100).toArray());
}
