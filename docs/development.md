# Phát triển local

## Yêu cầu cài đặt

| Công cụ | Phiên bản | Ghi chú |
| --- | --- | --- |
| [uv](https://docs.astral.sh/uv/) | 0.12+ | Quản lý Python, virtualenv và lockfile |
| [Bun](https://bun.sh/) | 1.4+ | Quản lý package Node và chạy script |
| Git | 2.50+ | |

Bạn **không** cần cài Python riêng — `uv` sẽ tải đúng phiên bản được ghim trong
`backend/.python-version`.

Kiểm tra:

```bash
uv --version
bun --version
git --version
```

## Chạy lần đầu

```bash
git clone <repo-url> amigoact
cd amigoact

# Backend
cd backend
uv sync --all-groups
uv run uvicorn backend.main:app --reload --port 8100   # http://localhost:8100

# Frontend (terminal thứ hai)
cd frontend
bun install
bun run dev                                  # http://localhost:3000
```

Mở <http://localhost:8100/docs> để xem giao diện OpenAPI tương tác. Backend
dùng port 8100 vì port 8000 bị WSL port relay chiếm (container Portainer).

## Biến môi trường

Cả hai package đều đọc từ file `.env` nằm trong thư mục của chúng. Hãy copy file
mẫu rồi sửa — `.env` đã được git-ignore, còn `.env.example` được commit.

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

### Backend (tất cả đều có tiền tố `AMIGOACT_`)

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `AMIGOACT_APP_NAME` | `AmigoAct API` | Tên trả về từ `/api/health` và tiêu đề OpenAPI |
| `AMIGOACT_VERSION` | `0.1.0` | Trả về từ `/api/health` và `/version` |
| `AMIGOACT_ENVIRONMENT` | `development` | `development` \| `staging` \| `production` |
| `AMIGOACT_DEBUG` | `false` | Bật log chi tiết của FastAPI |
| `AMIGOACT_LOG_LEVEL` | `INFO` | `DEBUG` … `CRITICAL` |
| `AMIGOACT_API_PREFIX` | `/api` | Tiền tố dùng để gắn tất cả router |
| `AMIGOACT_CORS_ORIGINS` | `[]` | Mảng JSON các origin được phép, ví dụ `["http://localhost:3000"]` |

### Frontend

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8100` | Địa chỉ gốc của API |
| `PORT` | `3000` | Cổng dev server (bộ e2e dùng `3100`) |

Giá trị `NEXT_PUBLIC_*` được nội tuyến thẳng vào bundle phía client lúc build.
Không bao giờ đặt bí mật vào biến loại này.

## Lệnh thường dùng

### Backend (`cd backend`)

```bash
uv run ruff check .                          # lint
uv run ruff check --fix .                    # lint + tự sửa
uv run ruff format .                         # chỉ format
uv run mypy                                  # kiểm tra kiểu nghiêm ngặt
uv run pytest                                # toàn bộ test + coverage
uv run pytest -m unit                        # chạy một tầng
uv run pytest tests/unit/test_greeting.py    # chạy một file
uv run pytest -k "normalize"                 # chạy một khái niệm
uv run pytest --lf                           # chạy lại các test vừa fail
uv run pytest -x -q                          # dừng ở lỗi đầu tiên, im lặng
```

### Frontend (`cd frontend`)

```bash
bun run dev                                  # dev server
bun run build                                # build production
bun run start                                # chạy bản build production
bun run lint                                 # biome check
bun run lint:fix                             # biome check --write
bun run typecheck                            # tsc --noEmit
bun run test                                 # cả ba tầng vitest
bun run test:watch                           # chế độ watch
bun run test:unit | test:integration | test:regression
bun run test:coverage                        # + ngưỡng coverage
bun run e2e:install                          # một lần: tải Chromium
bun run e2e                                  # Playwright end-to-end
bun run e2e:ui                               # giao diện Playwright, để debug
bun run e2e:report                           # mở báo cáo HTML gần nhất
bun run check                                # lint + typecheck + test
```

### Thư mục gốc

```bash
bun run scripts/check-file-size.mjs            # toàn bộ file
bun run scripts/check-file-size.mjs --staged   # chỉ file đã staged
bun run scripts/check-file-size.mjs --json     # máy đọc được
```

## Chạy toàn bộ kiểm tra

```bash
cd backend  && uv run ruff check . && uv run mypy && uv run pytest && cd ..
cd frontend && bun run check && bun run e2e && cd ..
bun run scripts/check-file-size.mjs
```

Đây chính xác là những gì CI thực hiện. Xem [ci.md](ci.md).

## Hook pre-commit (không bắt buộc)

```bash
bun run scripts/check-file-size.mjs --staged
```

Nếu bạn muốn tự động chạy:

```bash
printf '#!/bin/sh\nbun run scripts/check-file-size.mjs --staged\n' > .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit   # bỏ qua dòng này trên Windows
```

## Xử lý sự cố

**`uv` báo lỗi hardlink trên Windows.**
Không ảnh hưởng. Bỏ qua bằng `set UV_LINK_MODE=copy` hoặc
`uv sync --link-mode=copy`.

**`bun run lint` báo "couldn't find an ignore file".**
`biome.json` đặt `vcs.enabled: false` vì repo chỉ có một `.gitignore` ở thư mục
gốc, còn Biome chỉ tìm trong thư mục làm việc của chính nó. Thay vào đó, các
thư mục sinh ra được liệt kê trong `files.includes`. Nếu bạn thêm thư mục build
mới, hãy thêm vào đó luôn.

**`bun run e2e` hỏng ngay với lỗi trình duyệt.**
Chưa cài Chromium. Chạy `bun run e2e:install` một lần.

**Cổng 3000 hoặc 8100 đã bị chiếm.**
Dùng `PORT=3100 bun run dev` cho frontend;
`uv run uvicorn backend.main:app --port 8200` cho backend (nhớ đổi
`NEXT_PUBLIC_API_URL` tương ứng). Port 8000 luôn bị WSL port relay chiếm khi
container Portainer đang chạy — không dùng 8000 cho uvicorn.

**Test chạy riêng thì pass nhưng chạy đủ bộ thì fail.**
Rò rỉ trạng thái. Backend: fixture `autouse` trong `tests/conftest.py` đã xử lý
việc biến môi trường rò rỉ qua `reset_settings_cache()`. Frontend: kiểm tra xem
có module nào bị mutate ở cấp module, hoặc `vi.mock` mà thiếu `restoreMocks`
không.
