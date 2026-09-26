# AmigoAct

Xây dựng thói quen cùng nhau, từng hoạt động một.

Hệ thống quản lý hoạt động tình nguyện cho Đoàn trường và các tổ chức sinh
viên: tổ chức tạo và công bố hoạt động, đoàn viên đăng ký tham gia, ban chấp
hành duyệt đăng ký, điểm danh tại sự kiện bằng mã QR/mã nhập tay, ghi nhận
giờ tình nguyện và điểm rèn luyện, cấp chứng nhận PDF và tổng hợp báo cáo
theo khoa và theo tháng.

Monorepo fullstack: dịch vụ **FastAPI** và frontend **Next.js 16**.

| | Công nghệ |
| --- | --- |
| `backend/` | Python 3.14 · FastAPI · SQLAlchemy 2.0 async trên Oracle (python-oracledb thin) · argon2id + JWT · uv · ruff · mypy (strict) · pytest |
| `frontend/` | TypeScript 5 · React 19 · Next.js 16 App Router · TanStack Query · Tailwind 4 · Bun · biome · Vitest · Playwright |

## Bắt đầu nhanh

```bash
# 0. Cơ sở dữ liệu — Oracle Free trong Docker (chi tiết: backend/README.md)
docker run -d --name myoracle -p 1521:1521 \
  -e ORACLE_PASSWORD=SysPassword1 -e ORACLE_DATABASE=MyOracleDB \
  -v oracle_data:/opt/oracle/oradata gvenzl/oracle-free

# 1. Backend — http://localhost:8100
cd backend && uv sync --all-groups && cp .env.example .env
#    điền vào .env: AMIGOACT_DB_PASSWORD=<mật khẩu schema>,
#                   AMIGOACT_JWT_SECRET=<chuỗi ngẫu nhiên dài>
#    (AMIGOACT_TIMEZONE mặc định Asia/Ho_Chi_Minh — không bắt buộc)
.\reset_database.ps1               # tạo schema AMIGOACT + áp schema.sql
#    (script hỏi mật khẩu admin — SysPassword1 nếu bạn dùng docker run ở trên)
uv run uvicorn backend.main:app --reload --port 8100

# 2. Frontend — http://localhost:3000
cd frontend && bun install && cp .env.example .env.local
bun run dev
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
- [Thiết kế giao diện](docs/ui-design.md) — theme, panel, icon, component dùng chung
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
