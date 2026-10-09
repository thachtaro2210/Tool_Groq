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
const mask = (k: string) => `${k.slice(0, 8)}...${k.slice(-4)}`;

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

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("token") ?? "");
  const [authed, setAuthed] = useState(false);
  const [booting, setBooting] = useState(() => !!localStorage.getItem("token"));
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [keys, setKeys] = useState<Key[]>([]);
  const [text, setText] = useState("");
  const [results, setResults] = useState<{ key: string; res: Check }[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");
  const timer = useRef<number>();

  const say = (m: string) => {
    setToast(m);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(""), 2200);
  };

  const call = useCallback(
    async (path: string, method = "GET", body?: unknown, qs = "") => {
      const r = await fetch(`/api/admin/${path}${qs}`, {
        method,
        headers: { "Content-Type": "application/json", "x-admin-token": token },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await r.json().catch(() => ({}));
      if (r.status === 401) logout();
      if (!r.ok) throw new Error(data.error ?? `Lỗi ${r.status}`);
      return data;
    },
    [token], // eslint-disable-line react-hooks/exhaustive-deps
  );

  function logout() {
    localStorage.removeItem("token");
    setToken(""); setAuthed(false); setKeys([]);
  }

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoggingIn(true); setErr("");
    try {
      const r = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user.trim(), password: pass }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? `Lỗi ${r.status}`);
      localStorage.setItem("token", data.token);
      setPass("");
      setToken(data.token);
    } catch (e2) { setErr((e2 as Error).message); }
    setLoggingIn(false);
  };
  const api = (method = "GET", body?: unknown, qs = "") => call("keys", method, body, qs);

  const load = useCallback(async () => {
    try {
      setKeys(await call("keys"));
      setAuthed(true);
      setErr("");
    } catch (e) {
      if (!localStorage.getItem("token")) setErr("Phiên đăng nhập hết hạn, vui lòng đăng nhập lại");
      else say((e as Error).message);
    }
    setBooting(false);
  }, [call]);

  useEffect(() => { if (token) void load(); else setBooting(false); }, [token]); // eslint-disable-line
  useEffect(() => {
    if (!authed) return;
    const t = setInterval(() => void load(), 8000);
    return () => clearInterval(t);
  }, [authed, load]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); await load(); if (ok) say(ok); } catch (e) { say((e as Error).message); }
  };

  const parsed = [...new Set(text.split(/[\s,]+/).filter(Boolean))];

  const checkNew = async () => {
    setChecking(true);
    try {
      const res = await Promise.all(
        parsed.slice(0, 10).map(async (key) => ({ key, res: (await call("check", "POST", { key })) as Check })),
      );
      setResults(res);
    } catch (e) { say((e as Error).message); }
    setChecking(false);
  };

  const valid = (results ?? []).filter((r) => r.res.ok);
  const save = () => act(async () => {
    const checks = Object.fromEntries(valid.map((r) => [r.key, r.res]));
    await api("POST", { keys: valid.map((r) => r.key), checks });
    setText(""); setResults(null);
  }, `Đã lưu ${valid.length} key`);

  const recheck = async (id: string) => {
    setBusyId(id);
    try { await call("check", "POST", { id }); await load(); } catch (e) { say((e as Error).message); }
    setBusyId(null);
  };

  const copy = (s: string) => navigator.clipboard.writeText(s).then(() => say("Đã sao chép"));

  if (booting) return null;

  if (!authed)
    return (
      <div className="login">
        <h1>Xoay Key</h1>
        <p className="sub">Đăng nhập để quản lý key Groq</p>
        <form onSubmit={login}>
          <input className="in" autoFocus autoComplete="username" placeholder="Tài khoản" value={user} onChange={(e) => setUser(e.target.value)} />
          <input className="in" type="password" autoComplete="current-password" placeholder="Mật khẩu" value={pass} onChange={(e) => setPass(e.target.value)} />
          <button className="btn pri" disabled={!user.trim() || !pass || loggingIn}>{loggingIn ? "Đang đăng nhập..." : "Đăng nhập"}</button>
        </form>
        {err && <p className="err">{err}</p>}
      </div>
    );

  const now = Date.now();
  const kind = (k: Key) =>
    k.status === "invalid" ? "invalid" : k.status === "disabled" ? "off" : k.cooldownUntil > now ? "rest" : "ready";
  const ready = keys.filter((k) => kind(k) === "ready");
  const current = ready.reduce<Key | null>((a, k) => (!a || k.createdAt < a.createdAt ? k : a), null);
  const rows = [...keys].sort((a, b) => a.createdAt - b.createdAt);

  const base = location.origin;
  const snippetGet = `GET ${base}/api/key\nAuthorization: Bearer <PLATFORM_TOKEN>`;
  const snippetFail = `POST ${base}/api/key\nAuthorization: Bearer <PLATFORM_TOKEN>\n\n{ "failedKey": "gsk_...", "retryAfter": 3600 }`;

  return (
    <div className="wrap">
      <div className="head">
        <div>
          <h1>Xoay Key</h1>
          <p className="sub">Key Groq tự đổi khi hết token.</p>
        </div>
        <div className="stats">
          <span className="chip"><b>{ready.length}</b> sẵn sàng</span>
          <span className="chip"><b>{keys.length}</b> tổng</span>
          <button className="btn sm ghost" onClick={logout}>Đăng xuất</button>
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
          <button className="btn pri" disabled={!parsed.length || checking} onClick={checkNew}>
            {checking ? "Đang kiểm tra..." : "Kiểm tra"}
          </button>
        </div>

        {results && (
          <div className="results">
            {results.map(({ key, res }) => (
              <div className="rrow" key={key}>
                <span className={`dot ${res.ok ? (res.limited ? "rest" : "ready") : "invalid"}`} />
                <div className="main">
                  <div className="kname">{mask(key)}</div>
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

      <section className="panel">
        {rows.length ? (
          <ul className="list">
            {rows.map((k) => {
              const s = kind(k);
              const isOpen = open === k._id;
              return (
                <li className="item" key={k._id}>
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
                  {isOpen && <Detail c={k.check} busy={busyId === k._id} onCheck={() => recheck(k._id)} />}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="empty"><b>Chưa có key nào</b>Dán key Groq ở trên để bắt đầu.</div>
        )}
      </section>

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
