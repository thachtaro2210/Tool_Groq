# Xoay Key Groq

Quản lý nhiều key Groq và tự đổi key khi hết token. React + Vite + TS, backend là Vercel Serverless Functions (`/api`), DB MongoDB Atlas.

- `GET /api/key` lấy key đang dùng; `POST /api/key { failedKey, retryAfter? }` báo key hết token và nhận key mới (Bearer `PLATFORM_TOKEN`).
- Trang quản lý: đăng nhập, thêm/kiểm tra key, xem model và hạn mức còn lại.

Env: xem `.env.example`. Chạy local: `npm i && vercel dev`.
