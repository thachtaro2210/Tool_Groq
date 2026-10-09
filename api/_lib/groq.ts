import type { CheckResult } from "./db.js";

const BASE = "https://api.groq.com/openai/v1";
const NON_CHAT = /whisper|guard|tts|orpheus|playai|embed/i;

const num = (v: string | null) => (v !== null && v !== "" && !isNaN(Number(v)) ? Number(v) : undefined);

/** Kiểm tra key: danh sách model đang hoạt động + hạn mức còn lại (đọc từ header của 1 request ~1 token). */
export async function probeKey(key: string): Promise<CheckResult> {
  const at = Date.now();
  const auth = { Authorization: `Bearer ${key}` };
  try {
    const mr = await fetch(`${BASE}/models`, { headers: auth });
    if (mr.status === 401 || mr.status === 403)
      return { at, ok: false, error: "Key không hợp lệ hoặc đã bị thu hồi", models: [] };
    if (!mr.ok) return { at, ok: false, error: `Groq trả lỗi ${mr.status}`, models: [] };

    const body = (await mr.json()) as { data: { id: string; owned_by: string; active?: boolean; context_window: number }[] };
    const models = body.data
      .filter((m) => m.active !== false)
      .map((m) => ({ id: m.id, owner: m.owned_by, ctx: m.context_window }))
      .sort((a, b) => a.id.localeCompare(b.id));

    const probe = models.find((m) => m.id === "llama-3.1-8b-instant") ?? models.find((m) => !NON_CHAT.test(m.id));
    const result: CheckResult = { at, ok: true, models, probeModel: probe?.id };
    if (!probe) return result;

    const cr = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ model: probe.id, max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
    });
    const h = cr.headers;
    result.limits = {
      tokensLimit: num(h.get("x-ratelimit-limit-tokens")),
      tokensRemaining: num(h.get("x-ratelimit-remaining-tokens")),
      tokensReset: h.get("x-ratelimit-reset-tokens") ?? undefined,
      requestsLimit: num(h.get("x-ratelimit-limit-requests")),
      requestsRemaining: num(h.get("x-ratelimit-remaining-requests")),
      requestsReset: h.get("x-ratelimit-reset-requests") ?? undefined,
    };
    if (cr.status === 429) {
      result.limited = true;
      const t = await cr.text();
      try { result.message = JSON.parse(t).error?.message; } catch { result.message = t.slice(0, 300); }
      const ra = num(h.get("retry-after"));
      if (ra) result.limits.tokensReset ??= `${ra}s`;
    }
    return result;
  } catch (e) {
    return { at, ok: false, error: `Không gọi được Groq: ${(e as Error).message}`, models: [] };
  }
}
