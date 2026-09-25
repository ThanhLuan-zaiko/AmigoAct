# AmigoAct

Xây dựng thói quen cùng nhau, từng hoạt động một.

Monorepo fullstack: dịch vụ **FastAPI** và frontend **Next.js 16**.

| | Công nghệ |
| --- | --- |
| `backend/` | Python 3.14 · FastAPI · uv · ruff · mypy (strict) · pytest |
| `frontend/` | TypeScript 5 · React 19 · Next.js 16 App Router · Bun · biome · Vitest · Playwright |

## Bắt đầu nhanh

```bash
# Backend
cd backend && uv sync --all-groups && cp .env.example .env
uv run uvicorn backend.main:app --reload      # http://localhost:8000

# Frontend
cd frontend && bun install && cp .env.example .env
bun run dev                                   # http://localhost:3000
```

## Kiểm tra trước khi gửi PR

```bash
cd backend  && uv run ruff check . && uv run mypy && uv run pytest && cd ..
cd frontend && bun run check && bun run e2e && cd ..
bun run scripts/check-file-size.mjs
```

## Tài liệu

- [Đóng góp](CONTRIBUTING.md) — nhánh, commit, quy trình review
- [Phát triển](docs/development.md) — cài đặt, lệnh, xử lý sự cố
- [Kiến trúc](docs/architecture.md) — phân tầng và vòng đời request
- [Kiểm thử](docs/testing.md) — unit / tích hợp / hồi quy / e2e
- [CI](docs/ci.md) — mọi workflow và cách debug khi build đỏ
- [Hướng dẫn cho agent](AGENTS.md) — các quy tắc ràng buộc thay đổi mã nguồn

## Quy tắc chung

- **Giới hạn số dòng:** `.py` ≤ 400, `.tsx` ≤ 260, `.ts` ≤ 350. Hãy tách file,
  đừng để file phình ra.
- **Cấm mock data:** không dữ liệu giả hay record bịa trong bất kỳ code path nào
  chạy ngoài bộ test. Chưa có backend thì trả về empty-state thật, không bịa
  record để lấp chỗ trống. Placeholder gợi ý người dùng thì vẫn được phép.
- **Viết test trước.** Ba tầng — unit, tích hợp, hồi quy — mỗi tầng một nhiệm vụ
  riêng biệt.
- **Chỉ một `.gitignore`**, đặt ở thư mục gốc, dùng chung cho cả hai package.
- **Mã nghiệp vụ không phụ thuộc framework.** `backend/src/backend/domain/` và
  `frontend/lib/` không import framework nào — đó là lý do chúng test được nhanh.
- **Ngôn ngữ:** nội dung hiển thị trên web và mọi file `.md` dùng tiếng Việt có
  dấu; mã nguồn, comment chú thích và `AGENTS.md` dùng tiếng Anh.

## Giấy phép

[MIT](LICENSE)
