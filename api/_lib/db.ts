import dns from "node:dns";
import { MongoClient, type Collection, type Db, type ObjectId } from "mongodb";
import { encrypt, keyHash } from "./crypto.js";

export interface CheckResult {
  at: number;
  ok: boolean;
  error?: string;
  models: { id: string; owner: string; ctx: number }[];
  probeModel?: string;
  limited?: boolean; // Groq trả 429 khi thử -> đang hết hạn mức
  message?: string;
  limits?: {
    tokensLimit?: number; tokensRemaining?: number; tokensReset?: string; // theo phút
    requestsLimit?: number; requestsRemaining?: number; requestsReset?: string; // theo ngày
  };
}

export interface KeyDoc {
  check?: CheckResult;
  _id: ObjectId;
  keyEnc: string;  // AES-256-GCM
  keyHash: string; // HMAC để tra cứu/unique
  keyMask: string; // hiển thị
  status: "active" | "invalid" | "disabled";
  cooldownUntil: number; // epoch ms, 0 = sẵn sàng
  usageCount: number;
  failCount: number;
  lastUsedAt: number;
  lastError?: string;
  createdAt: number;
}
export interface SessionDoc { _id: string; ip: string; ua: string; createdAt: number; expireAt: Date }
export interface RateDoc { _id: string; n: number; expireAt: Date }
export interface AuditDoc { at: Date; type: string; ip: string; ok: boolean; ua?: string; note?: string }

export const maskKey = (k: string) => `${k.slice(0, 8)}...${k.slice(-4)}`;

// Một số mạng chặn DNS SRV mặc định -> cho phép chỉ định DNS server qua env
if (process.env.NODE_DNS_SERVERS) dns.setServers(process.env.NODE_DNS_SERVERS.split(",").map((s) => s.trim()));

let clientPromise: Promise<MongoClient> | undefined;
let ready: Promise<void> | undefined;

async function setup(db: Db) {
  const keys = db.collection<KeyDoc & { key?: string }>("keys");
  // Chuyển key plaintext cũ sang dạng mã hoá (chạy một lần, idempotent)
  for await (const d of keys.find({ key: { $exists: true } })) {
    await keys.updateOne(
      { _id: d._id },
      { $set: { keyEnc: encrypt(d.key!), keyHash: keyHash(d.key!), keyMask: maskKey(d.key!) }, $unset: { key: "" } },
    );
  }
  await keys.dropIndex("key_1").catch(() => {});
  await keys.createIndex({ keyHash: 1 }, { unique: true, partialFilterExpression: { keyHash: { $exists: true } } });
  await db.collection("sessions").createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 });
  await db.collection("ratelimit").createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 });
  await db.collection("audit").createIndex({ at: 1 }, { expireAfterSeconds: 30 * 86400 });
}

async function db(): Promise<Db> {
  if (!process.env.MONGODB_URI) throw new Error("Thiếu MONGODB_URI");
  clientPromise ??= new MongoClient(process.env.MONGODB_URI).connect();
  // MONGODB_DB bỏ trống -> dùng tên DB trong URI
  const d = (await clientPromise).db(process.env.MONGODB_DB || undefined);
  ready ??= setup(d).catch((e) => { ready = undefined; throw e; });
  await ready;
  return d;
}

export const keysCol = async (): Promise<Collection<KeyDoc>> => (await db()).collection<KeyDoc>("keys");
export const sessionsCol = async () => (await db()).collection<SessionDoc>("sessions");
export const rateCol = async () => (await db()).collection<RateDoc>("ratelimit");
export const auditCol = async () => (await db()).collection<AuditDoc>("audit");
