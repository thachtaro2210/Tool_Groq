import dns from "node:dns";
import { MongoClient, type Collection, type ObjectId } from "mongodb";

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
  key: string;
  status: "active" | "invalid" | "disabled";
  cooldownUntil: number; // epoch ms, 0 = sẵn sàng
  usageCount: number;
  failCount: number;
  lastUsedAt: number;
  lastError?: string;
  createdAt: number;
}

// Một số mạng chặn DNS SRV mặc định -> cho phép chỉ định DNS server qua env
if (process.env.NODE_DNS_SERVERS) dns.setServers(process.env.NODE_DNS_SERVERS.split(",").map((s) => s.trim()));

let clientPromise: Promise<MongoClient> | undefined;
let indexed = false;

export async function keysCol(): Promise<Collection<KeyDoc>> {
  if (!process.env.MONGODB_URI) throw new Error("Thiếu MONGODB_URI");
  clientPromise ??= new MongoClient(process.env.MONGODB_URI).connect();
  // MONGODB_DB bỏ trống -> dùng tên DB trong URI
  const col = (await clientPromise).db(process.env.MONGODB_DB || undefined).collection<KeyDoc>("keys");
  if (!indexed) {
    await col.createIndex({ key: 1 }, { unique: true });
    indexed = true;
  }
  return col;
}
