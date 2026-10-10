import { useCallback, useEffect, useRef, useState } from "react";

interface Check {
  at: number; ok: boolean; error?: string;
  models: { id: string; owner: string; ctx: number }[];
  probeModel?: string; limited?: boolean; message?: string;
  limits?: {
    tokensLimit?: number; tokensRemaining?: number; tokensReset?: string;
    requestsLimit?: number; requestsRemaining?: number; requestsReset?: string;
  };
}
interface Key {
  _id: string; key: string; status: "active" | "invalid" | "disabled";
  cooldownUntil: number; usageCount: number; failCount: number;
  lastUsedAt: number; lastError?: string; createdAt: number; check?: Check;
}

const ago = (t: number) => {
  if (!t) return "chưa dùng";
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s} giây trước`;
  if (s < 3600) return `${Math.round(s / 60)} phút trước`;
  if (s < 86400) return `${Math.round(s / 3600)} giờ trước`;
  return `${Math.round(s / 86400)} ngày trước`;
};
const left = (t: number) => {
  const m = Math.ceil((t - Date.now()) / 60000);
  return m >= 60 ? `${Math.floor(m / 60)} giờ ${m % 60} phút` : `${m} phút`;
};
const n = (v?: number) => (v === undefined ? "—" : v.toLocaleString("vi-VN"));

function Meter({ label, rem, lim, reset }: { label: string; rem?: number; lim?: number; reset?: string }) {
  if (rem === undefined || !lim) return null;
  const pct = Math.max(0, Math.min(100, (rem / lim) * 100));
  return (
    <div className="meter">
      <div className="mrow"><span>{label}</span><span><b>{n(rem)}</b> / {n(lim)}{reset ? ` · làm mới sau ${reset}` : ""}</span></div>
      <div className="bar"><i className={pct < 15 ? "low" : ""} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function Detail({ c, busy, onCheck }: { c?: Check; busy: boolean; onCheck: () => void }) {
  return (
    <div className="detail">
      {!c ? (
        <p className="mut">Chưa kiểm tra key này.</p>
      ) : !c.ok ? (
        <p className="bad">{c.error}</p>
      ) : (
        <>
          {c.limited && <p className="bad">Key đang chạm hạn mức: {c.message}</p>}
          <Meter label="Token / phút còn lại" rem={c.limits?.tokensRemaining} lim={c.limits?.tokensLimit} reset={c.limits?.tokensReset} />
          <Meter label="Request / ngày còn lại" rem={c.limits?.requestsRemaining} lim={c.limits?.requestsLimit} reset={c.limits?.requestsReset} />
          <div className="mlabel">{c.models.length} model đang hoạt động</div>
          <div className="models">
            {c.models.map((m) => <span key={m.id} className="mchip" title={`${m.owner} · ${n(m.ctx)} ctx`}>{m.id}</span>)}
          </div>
        </>
      )}
      <div className="drow">
        <span className="mut">{c ? `Kiểm tra ${ago(c.at)}` : ""}</span>
        <button className="btn sm" disabled={busy} onClick={onCheck}>{busy ? "Đang kiểm tra..." : "Kiểm tra lại"}</button>
      </div>
    </div>
  );
}

// Giá tham khảo Groq (USD / 1 triệu token) — có thể sửa trực tiếp trong ô nhập
const PRICES: Record<string, [number, number]> = {
  "llama-3.1-8b-instant": [0.05, 0.08],
  "llama-3.3-70b-versatile": [0.59, 0.79],
  "openai/gpt-oss-20b": [0.075, 0.3],
  "openai/gpt-oss-120b": [0.15, 0.6],
  "meta-llama/llama-4-scout-17b-16e-instruct": [0.11, 0.34],
  "meta-llama/llama-4-maverick-17b-128e-instruct": [0.2, 0.6],
  "qwen/qwen3-32b": [0.29, 0.59],
  "moonshotai/kimi-k2-instruct": [1, 3],
};
const store = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const usd = (v: number) => `$${v >= 1 ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : v.toLocaleString("en-US", { maximumSignificantDigits: 2 })}`;
const vnd = (v: number) => `${Math.round(v).toLocaleString("vi-VN")}đ`;

function Num({ label, value, onChange, step = 1, suffix }: { label: string; value: number; onChange: (v: number) => void; step?: number; suffix?: string }) {
  return (
    <label className="fld">
      <span>{label}</span>
      <div className="fin">
        <input className="in" type="number" min={0} step={step} value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(Math.max(0, parseFloat(e.target.value) || 0))} />
        {suffix && <em>{suffix}</em>}
      </div>
    </label>
  );
}

function CostPanel({ keys, ready }: { keys: Key[]; ready: Key[] }) {
  const [model, setModel] = useState(() => store("cost.model", "llama-3.3-70b-versatile"));
  const [pin, setPin] = useState(() => PRICES[model]?.[0] ?? 0.59);
  const [pout, setPout] = useState(() => PRICES[model]?.[1] ?? 0.79);
  const [tin, setTin] = useState(() => Number(store("cost.tin", "1500")));
  const [tout, setTout] = useState(() => Number(store("cost.tout", "500")));
  const [rpd, setRpd] = useState(() => Number(store("cost.rpd", "2000")));
  const [rate, setRate] = useState(() => Number(store("cost.rate", "25000")));

  useEffect(() => {
    try {
      localStorage.setItem("cost.model", model); localStorage.setItem("cost.tin", String(tin));
      localStorage.setItem("cost.tout", String(tout)); localStorage.setItem("cost.rpd", String(rpd)); localStorage.setItem("cost.rate", String(rate));
    } catch { /* bỏ qua */ }
  }, [model, tin, tout, rpd, rate]);

  const pick = (m: string) => { setModel(m); if (PRICES[m]) { setPin(PRICES[m][0]); setPout(PRICES[m][1]); } };

  const sum = (f: (k: Key) => number | undefined, src: Key[]) => src.reduce((a, k) => a + (f(k) ?? 0), 0);
  const tokLim = sum((k) => k.check?.limits?.tokensLimit, ready);
  const tokRem = sum((k) => k.check?.limits?.tokensRemaining, ready);
  const reqLim = sum((k) => k.check?.limits?.requestsLimit, ready);
  const reqRem = sum((k) => k.check?.limits?.requestsRemaining, ready);
  const served = sum((k) => k.usageCount, keys);

  const perReq = (tin * pin + tout * pout) / 1e6;
  const perDay = perReq * rpd;
  const perMonth = perDay * 30;
  const tokPerReq = tin + tout;
  const reqPerMin = tokPerReq ? Math.floor(tokLim / tokPerReq) : 0;
  const perKeyReq = ready.length && reqLim ? reqLim / ready.length : 0;
  const perKeyTok = ready.length && tokLim ? tokLim / ready.length : 0;
  const needByDay = perKeyReq ? Math.ceil(rpd / perKeyReq) : 0;
  const needByMin = perKeyTok ? Math.ceil((rpd * tokPerReq) / 1440 / perKeyTok) : 0;
  const need = Math.max(needByDay, needByMin);

  return (
    <aside className="side">
      <section className="panel pad">
        <h2 className="ptitle">Dung lượng hệ thống</h2>
        <div className="kpis">
          <div className="kpi"><span>Key sẵn sàng</span><b>{ready.length}<small> / {keys.length}</small></b></div>
          <div className="kpi"><span>Đã cấp key</span><b>{n(served)}<small> lần</small></b></div>
        </div>
        {tokLim > 0 ? (
          <div className="stack">
            <Meter label="Token / phút (gộp)" rem={tokRem} lim={tokLim} />
            {reqLim > 0 && <Meter label="Request / ngày (gộp)" rem={reqRem} lim={reqLim} />}
            <p className="hint">Cộng từ {ready.length} key sẵn sàng đã kiểm tra. Mở một key → “Kiểm tra lại” để cập nhật số liệu.</p>
          </div>
        ) : (
          <p className="hint">Chưa có số liệu hạn mức. Mở một key và bấm “Kiểm tra lại”.</p>
        )}
      </section>

      <section className="panel pad">
        <h2 className="ptitle">Tính chi phí</h2>
        <label className="fld">
          <span>Model</span>
          <select className="in" value={model} onChange={(e) => pick(e.target.value)}>
            {!PRICES[model] && <option value={model}>Tuỳ chỉnh</option>}
            {Object.keys(PRICES).map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <div className="grid2">
          <Num label="Giá input" value={pin} step={0.01} onChange={(v) => { setPin(v); setModel("custom"); }} suffix="$/1M" />
          <Num label="Giá output" value={pout} step={0.01} onChange={(v) => { setPout(v); setModel("custom"); }} suffix="$/1M" />
          <Num label="Token vào / request" value={tin} step={100} onChange={setTin} />
          <Num label="Token ra / request" value={tout} step={50} onChange={setTout} />
          <Num label="Request / ngày" value={rpd} step={100} onChange={setRpd} />
          <Num label="Tỷ giá" value={rate} step={500} onChange={setRate} suffix="đ/$" />
        </div>
        <div className="bill">
          <div className="brow"><span>1 request</span><b>{usd(perReq)} <small>≈ {vnd(perReq * rate)}</small></b></div>
          <div className="brow"><span>1 ngày</span><b>{usd(perDay)} <small>≈ {vnd(perDay * rate)}</small></b></div>
          <div className="brow tot"><span>1 tháng (30 ngày)</span><b>{usd(perMonth)} <small>≈ {vnd(perMonth * rate)}</small></b></div>
        </div>
        <p className="hint">Giá tham khảo của Groq nếu dùng gói trả phí. Key free thì chi phí thực tế là 0đ — đây là số tiền bạn tiết kiệm được.</p>
      </section>

      <section className="panel pad">
        <h2 className="ptitle">Ước tính tải</h2>
        <div className="bill">
          <div className="brow"><span>Token / request</span><b>{n(tokPerReq)}</b></div>
          <div className="brow"><span>Token / ngày cần</span><b>{n(rpd * tokPerReq)}</b></div>
          <div className="brow"><span>Tối đa / phút (pool)</span><b>{tokLim ? `${n(reqPerMin)} request` : "—"}</b></div>
          <div className="brow"><span>Hạn mức / ngày (pool)</span><b>{reqLim ? `${n(reqLim)} request` : "—"}</b></div>
          <div className="brow tot"><span>Đánh giá</span>
            <b className={need > ready.length ? "badtxt" : "oktxt"}>
              {!need ? "Chưa đủ dữ liệu" : need > ready.length ? `Thiếu ~${need - ready.length} key` : `Đủ (cần ~${need} key)`}
            </b>
          </div>
        </div>
      </section>
    </aside>
  );
}

type Theme = "auto" | "light" | "dark";
const THEMES: [Theme, string][] = [["light", "Sáng"], ["dark", "Tối"], ["auto", "Tự động"]];

function ThemeSwitch({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const t = store("theme", "auto");
    return t === "light" || t === "dark" ? t : "auto";
  });
  useEffect(() => {
    const el = document.documentElement;
    if (theme === "auto") delete el.dataset.theme; else el.dataset.theme = theme;
    try { theme === "auto" ? localStorage.removeItem("theme") : localStorage.setItem("theme", theme); } catch { /* bỏ qua */ }
  }, [theme]);
  return (
    <div className={`theme ${className}`} role="group" aria-label="Giao diện">
      {THEMES.map(([t, l]) => <button key={t} className={theme === t ? "on" : ""} aria-pressed={theme === t} onClick={() => setTheme(t)}>{l}</button>)}
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(() => localStorage.getItem("authed") === "1"); // chỉ là cờ giao diện, phiên thật nằm ở cookie HttpOnly
  const [otpNeeded, setOtpNeeded] = useState(false);
  const [otp, setOtp] = useState("");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [keys, setKeys] = useState<Key[] | null>(null); // null = đang tải lần đầu
  const [text, setText] = useState("");
  const [results, setResults] = useState<{ key: string; res: Check }[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");
  const timer = useRef<number>();

  // Một bộ đếm loading dùng chung cho mọi thao tác (đăng nhập, tải, thêm, kiểm tra, xoá...)
  const [pending, setPending] = useState(0);
  const loading = pending > 0;
  const track = async <T,>(fn: () => Promise<T>): Promise<T> => {
    setPending((p) => p + 1);
    try { return await fn(); } finally { setPending((p) => p - 1); }
  };

  const say = (m: string) => {
    setToast(m);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(""), 2200);
  };

  const call = useCallback(
    async (path: string, method = "GET", body?: unknown, qs = "") => {
      const r = await fetch(`/api/admin/${path}${qs}`, {
        method,
        headers: { "Content-Type": "application/json", "x-requested-with": "xoaykey" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await r.json().catch(() => ({}));
      if (r.status === 401) logout("Phiên đăng nhập hết hạn, vui lòng đăng nhập lại");
      if (!r.ok) throw new Error(data.error ?? `Lỗi ${r.status}`);
      return data;
    },
    [authed], // eslint-disable-line react-hooks/exhaustive-deps
  );

  function logout(reason = "", server = false) {
    if (server) void fetch("/api/admin/login", { method: "DELETE", headers: { "x-requested-with": "xoaykey" } }).catch(() => {});
    localStorage.removeItem("authed");
    setAuthed(false); setKeys(null); setOpen(null); setResults(null); setErr(reason);
  }

  const login = (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    return track(async () => {
      try {
        const r = await fetch("/api/admin/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: user.trim(), password: pass, otp: otp.trim() }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error ?? `Lỗi ${r.status}`);
        localStorage.setItem("authed", "1");
        setPass(""); setOtp("");
        setAuthed(true); // vào panel ngay, effect bên dưới sẽ tải danh sách
      } catch (e2) { setErr((e2 as Error).message); }
    });
  };
  const api = (method = "GET", body?: unknown, qs = "") => call("keys", method, body, qs);

  const fetchKeys = useCallback(async () => {
    try { setKeys(await call("keys")); } catch (e) { say((e as Error).message); }
  }, [call]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (authed) void track(fetchKeys); }, [authed]); // eslint-disable-line
  useEffect(() => {
    fetch("/api/admin/login").then((r) => r.json()).then((d) => setOtpNeeded(!!d.otp)).catch(() => {});
  }, []);

  const act = (fn: () => Promise<unknown>, ok?: string) =>
    track(async () => {
      try { await fn(); await fetchKeys(); if (ok) say(ok); } catch (e) { say((e as Error).message); }
    });

  const parsed = [...new Set(text.split(/[\s,]+/).filter(Boolean))];

  const checkNew = () =>
    track(async () => {
      try {
        setResults(await Promise.all(
          parsed.slice(0, 10).map(async (key) => ({ key, res: (await call("check", "POST", { key })) as Check })),
        ));
      } catch (e) { say((e as Error).message); }
    });

  const valid = (results ?? []).filter((r) => r.res.ok);
  const save = () => act(async () => {
    const checks = Object.fromEntries(valid.map((r) => [r.key, r.res]));
    await api("POST", { keys: valid.map((r) => r.key), checks });
    setText(""); setResults(null);
  }, `Đã lưu ${valid.length} key`);

  const recheck = (id: string) => act(() => call("check", "POST", { id }));

  const copy = (s: string) => navigator.clipboard.writeText(s).then(() => say("Đã sao chép"));

  if (!authed)
    return (
      <div className={`login${loading ? " busy" : ""}`}>
        <ThemeSwitch className="theme-float" />
        <div className={`progress${loading ? " on" : ""}`} />
        <img className="logo big" src="/logo.svg" alt="KeyRelay" />
        <h1>KeyRelay</h1>
        <p className="sub">Đăng nhập để quản lý key Groq</p>
        <form onSubmit={login}>
          <input className="in" autoFocus autoComplete="username" placeholder="Tài khoản" value={user} onChange={(e) => setUser(e.target.value)} />
          <input className="in" type="password" autoComplete="current-password" placeholder="Mật khẩu" value={pass} onChange={(e) => setPass(e.target.value)} />
          {otpNeeded && <input className="in" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="Mã 2FA (6 số)" value={otp} onChange={(e) => setOtp(e.target.value)} />}
          <button className="btn pri" disabled={!user.trim() || !pass || (otpNeeded && otp.trim().length !== 6) || loading}>{loading ? "Đang đăng nhập..." : "Đăng nhập"}</button>
        </form>
        {err && <p className="err">{err}</p>}
      </div>
    );

  const now = Date.now();
  const kind = (k: Key) =>
    k.status === "invalid" ? "invalid" : k.status === "disabled" ? "off" : k.cooldownUntil > now ? "rest" : "ready";
  const list = keys ?? [];
  const ready = list.filter((k) => kind(k) === "ready");
  const current = ready.reduce<Key | null>((a, k) => (!a || k.createdAt < a.createdAt ? k : a), null);
  const rows = [...list].sort((a, b) => a.createdAt - b.createdAt);

  const base = location.origin;
  const snippetGet = `GET ${base}/api/key\nAuthorization: Bearer <PLATFORM_TOKEN>`;
  const snippetFail = `POST ${base}/api/key\nAuthorization: Bearer <PLATFORM_TOKEN>\n\n{ "failedKey": "gsk_...", "retryAfter": 3600 }`;

  return (
    <div className={`wrap${loading ? " busy" : ""}`}>
      <div className={`progress${loading ? " on" : ""}`} />
      <div className="head">
        <div className="brand">
          <img className="logo" src="/logo.svg" alt="" />
          <div>
            <h1>KeyRelay</h1>
            <p className="sub">Key Groq tự đổi khi hết token.</p>
          </div>
        </div>
        <div className="stats">
          <span className="chip"><b>{ready.length}</b> sẵn sàng</span>
          <span className="chip"><b>{list.length}</b> tổng</span>
          <ThemeSwitch />
          <button className="btn sm ghost" onClick={() => logout("", true)}>Đăng xuất</button>
        </div>
      </div>

      <section className="panel pad">
        <h2 className="ptitle">Thêm key</h2>
        <div className="add">
          <textarea
            className="in" rows={1} value={text} placeholder="Dán key Groq (nhiều key: mỗi dòng một key)"
            onChange={(e) => {
              setText(e.target.value); setResults(null);
              e.target.style.height = "auto"; e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
            }}
          />
          <button className="btn pri" disabled={!parsed.length || loading} onClick={checkNew}>
            {loading ? "Đang xử lý..." : "Kiểm tra"}
          </button>
        </div>

        {results && (
          <div className="results">
            {results.map(({ key, res }) => (
              <div className="rrow" key={key}>
                <span className={`dot ${res.ok ? (res.limited ? "rest" : "ready") : "invalid"}`} />
                <div className="main">
                  <div className="kname">{key}</div>
                  <div className="meta">
                    {res.ok
                      ? `${res.models.length} model hoạt động${res.limits?.tokensRemaining !== undefined ? ` · còn ${n(res.limits.tokensRemaining)} token/phút` : ""}${res.limited ? " · đang chạm hạn mức" : ""}`
                      : res.error}
                  </div>
                </div>
              </div>
            ))}
            {parsed.length > 10 && <p className="mut" style={{ margin: "8px 0 0" }}>Chỉ kiểm tra 10 key đầu mỗi lần.</p>}
            <div className="rfoot">
              <button className="btn pri" disabled={!valid.length} onClick={save}>
                {valid.length ? `Lưu ${valid.length} key hợp lệ` : "Không có key hợp lệ"}
              </button>
            </div>
          </div>
        )}
      </section>

      <div className="cols">
      <section className="panel listpanel">
        {keys === null ? (
          <div className="skel">
            <div className="loadmsg"><img className="logo spinlogo" src="/logo.svg" alt="" />Đang tải danh sách key...</div>
            {[0, 1, 2].map((i) => <div key={i} className="skrow" />)}
          </div>
        ) : rows.length ? (
          <ul className="list">
            {rows.map((k) => {
              const s = kind(k);
              const isOpen = open === k._id;
              return (
                <li className={`item${isOpen ? " open" : ""}`} key={k._id}>
                  <div className="irow">
                    <span className={`dot ${s}`} />
                    <button className="main toggle" onClick={() => setOpen(isOpen ? null : k._id)} aria-expanded={isOpen}>
                      <div className="kname">
                        {k.key}
                        {k._id === current?._id && <span className="tag use">Đang dùng</span>}
                        {s === "rest" && <span className="tag rest">Hết token · còn {left(k.cooldownUntil)}</span>}
                        {s === "invalid" && <span className="tag invalid">Key lỗi</span>}
                        {s === "off" && <span className="tag off">Đã tắt</span>}
                      </div>
                      <div className="meta" title={k.lastError}>
                        Cấp {k.usageCount} lần · {ago(k.lastUsedAt)}
                        {k.check?.ok && ` · ${k.check.models.length} model`}
                        {k.check?.limits?.tokensRemaining !== undefined && ` · còn ${n(k.check.limits.tokensRemaining)} token/phút`}
                      </div>
                    </button>
                    <div className="acts">
                      {(s === "rest" || s === "invalid") && (
                        <button className="btn sm ghost" onClick={() => act(() => api("PATCH", { id: k._id, action: "reset" }), "Đã dùng lại key")}>Dùng lại</button>
                      )}
                      <button className="btn sm ghost" onClick={() => act(() => api("PATCH", { id: k._id, action: k.status === "disabled" ? "enable" : "disable" }))}>
                        {k.status === "disabled" ? "Bật" : "Tắt"}
                      </button>
                      <button className="btn sm ghost danger" onClick={() => confirm("Xoá key này?") && act(() => api("DELETE", undefined, `?id=${k._id}`), "Đã xoá")}>Xoá</button>
                    </div>
                  </div>
                  {isOpen && <Detail c={k.check} busy={loading} onCheck={() => recheck(k._id)} />}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="empty"><b>Chưa có key nào</b>Dán key Groq ở trên để bắt đầu.</div>
        )}
      </section>
      {keys !== null && <CostPanel keys={list} ready={ready} />}
      </div>

      <details className="panel">
        <summary><span className="ptitle" style={{ margin: 0 }}>Tích hợp với bên B</span></summary>
        <div className="steps">
          <div className="step">
            <p>1. Lấy key đang dùng:</p>
            <div className="code">{snippetGet}<button className="btn sm" onClick={() => copy(snippetGet)}>Chép</button></div>
          </div>
          <div className="step">
            <p>2. Khi Groq báo hết token, bắn key đó về đây và nhận key mới:</p>
            <div className="code">{snippetFail}<button className="btn sm" onClick={() => copy(snippetFail)}>Chép</button></div>
          </div>
        </div>
      </details>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
