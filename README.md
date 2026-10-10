# KeyRelay

Quản lý nhiều key Groq và tự đổi key khi hết token. React + Vite + TS, backend là Vercel Serverless Functions (`/api`), DB MongoDB Atlas.

- `GET /api/key` lấy key đang dùng; `POST /api/key { failedKey, retryAfter? }` báo key hết token và nhận key mới (Bearer `PLATFORM_TOKEN`).
- Trang quản lý: đăng nhập, thêm/kiểm tra key, xem model và hạn mức còn lại.

Env: xem `.env.example`. Chạy local: `npm i && vercel dev`.

## Bảo mật

- Key trong DB được mã hoá AES-256-GCM (`KEY_ENCRYPTION_SECRET`, ≥32 ký tự); tra cứu bằng HMAC. Key plaintext cũ tự được chuyển đổi ở lần kết nối đầu tiên. **Mất secret = mất key**, hãy sao lưu.
- Đăng nhập: phiên lưu trong DB, gửi bằng cookie `HttpOnly; Secure; SameSite=Strict` (12h, thu hồi được, đăng xuất xoá phiên thật). `ADMIN_PASSWORD` ≥ 6 ký tự.
- 2FA tuỳ chọn: đặt `ADMIN_TOTP_SECRET` (base32) rồi thêm vào Google Authenticator/Authy. Mã dùng một lần.
- `/api/key`: giới hạn 60 req/phút/IP, khoá 10 phút sau 10 lần sai token, tuỳ chọn `PLATFORM_ALLOWED_IPS`. Token ≥ 24 ký tự.
- Mọi lần đăng nhập và lấy key được ghi audit (30 ngày): `GET /api/admin/audit`.
- Header bảo mật + CSP chặt trong `vercel.json`.
- Thu hồi mọi phiên: `DELETE /api/admin/login?all=1`. Nghi lộ `PLATFORM_TOKEN`: đổi env rồi redeploy.
