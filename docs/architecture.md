# Kiến trúc

## Hình dạng tổng thể

```
┌──────────────────────────────────────────────────────────┐
│  frontend/  Next.js 16 App Router  (React 19, Bun)        │
│                                                          │
│   app/          route — mặc định là server component      │
│   components/   component client và component hiển thị    │
│   lib/          hàm trợ giúp không phụ thuộc framework     │
└───────────────────────┬──────────────────────────────────┘
                        │  HTTPS  /api/*
┌───────────────────────▼──────────────────────────────────┐
│  backend/  FastAPI  (Python 3.14, uv)                    │
│                                                          │
│   api/routers/   bề mặt HTTP: route, mã trạng thái       │
│   domain/        logic nghiệp vu  ← unit test            │
│   config.py      cấu hình đọc từ môi trường              │
│   main.py        app factory + điểm vào ASGI              │
└──────────────────────────────────────────────────────────┘
```

Hai package **không dùng chung mã nguồn**. Các hợp đồng (contract) dùng chung
được nhân bản có chủ đích và được bảo vệ từ cả hai phía bằng regression test —
xem [Hợp đồng liên stack](#hợp-đồng-liên-stack).

## Quy tắc phụ thuộc

Đây là quy tắc cấu trúc quan trọng nhất trong repo:

> `domain/` và `lib/` không được import framework đang chứa chúng.

| Tầng | Được import | Không được import |
| --- | --- | --- |
| `backend/src/backend/domain/` | thư viện chuẩn | `fastapi`, `starlette`, `pydantic`, `backend.api`, `backend.config` |
| `backend/src/backend/api/` | `backend.domain`, `backend.config`, `fastapi` | — |
| `frontend/lib/` | thư viện chuẩn, module `lib/` khác | `next/*`, `react`, `react-dom` |
| `frontend/components/` | `react`, `@/lib/*` | nội bộ server của `next/*` |
| `frontend/app/` | `next/*`, `@/components/*`, `@/lib/*` | — |

Logic nghiệp vụ mà biết đến HTTP thì không thể test mà không cần dựng request
object. Giữ nó không phụ thuộc framework chính là thứ làm cho tầng unit đủ nhanh
để chạy ở mỗi lần gõ phím.

## Vòng đời một request (backend)

1. `uvicorn` nhận một `scope` ASGI rồi gọi `app`.
2. Router của FastAPI đối chiếu path với các tiền tố đã đăng ký trong
   `create_app()` (`settings.api_prefix` cộng với tiền tố riêng của từng router).
3. FastAPI kiểm tra path và query param dựa trên chú thích kiểu của handler.
4. Handler gọi một hàm thuộc `domain/`. Hàm domain hoặc trả về giá trị, hoặc
   ném ra `ValueError`.
5. `ValueError` được handler đăng ký trong `create_app()` chuyển thành `422` với
   `{"detail": "..."}`. Mọi ngoại lệ khác trở thành `500`.
6. Response được tuần tự hoá theo chú thích kiểu trả về của handler.

`create_app()` trả về một application **mới** mỗi lần gọi. Biến `app` ở cấp
module chỉ là một instance đã dựng sẵn cho uvicorn. Test dựng instance riêng, và
đó là lý do override được biến môi trường.

## Cấu hình và bộ nhớ đệm

`Settings` là model `pydantic-settings`, được đọc đúng một lần qua một singleton
`lru_cache`. Chính bộ nhớ đệm đó là lý do `tests/conftest.py` cung cấp fixture
`build_app(**env)` thay vì yêu cầu test gọi `monkeypatch.setenv` rồi dùng lại
app đã dựng — app đó đã nắm giá trị trước khi override.

Đọc cấu hình: `get_settings()`. Ép đọc lại: `reset_settings_cache()`.

## Render (frontend)

Next.js App Router mặc định dùng **server component**. Một component trở thành
client component chỉ khi khai báo `"use client"` ở đầu file — làm vậy khi và chỉ
khi component cần state, effect, hoặc event handler. `GreetingCard` là ví dụ mẫu:
nó giữ một input có kiểm soát nên là client component, còn `app/page.tsx` vẫn là
server component chỉ đơn giản render nó.

Việc lấy dữ liệu thuộc về tầng server. Fetch bên trong `useEffect` tạo ra một
chuỗi request nối tiếp và hiện tượng nhấp nháy loading mà tầng server sẽ không
gặp phải.

## Hợp đồng liên stack

Các hằng số và hình dạng response mà cả hai phía đều dựa vào hiện đang được
**nhân bản** và ghim bằng test ở cả hai phía:

| Hợp đồng | Nguồn backend | Được bảo vệ bởi |
| --- | --- | --- |
| `MAX_NAME_LENGTH = 80` | `domain/greeting.py` | `backend/tests/regression/test_api_contract.py`, `frontend/tests/regression/api-contract.test.ts` |
| `DEFAULT_GREETING = "Xin chào"` | `domain/greeting.py` | hai file trên |
| `DEFAULT_NAME = "bạn"` | `domain/greeting.py` | hai file trên |
| `/api/greeting` → `{"message": str}` | `api/routers/health.py` | hai file trên |
| Tập key của `/api/health` | `api/routers/health.py` | `backend/tests/regression/test_api_contract.py` |

Khi bạn đổi một trong các giá trị này, hãy đổi cả hai phía **và** cả hai
regression test trong cùng một commit. Nếu sự nhân bản này thành nguồn lỗi
thường xuyên, cách khắc phục là tạo một package kiểu dữ liệu dùng chung được sinh
tự động — chứ không phải xoá bỏ một trong hai bên test.

## Ngôn ngữ

Sản phẩm dành cho người dùng tiếng Việt. Mọi nội dung hiển thị trên web và mọi
file `.md` dùng tiếng Việt có dấu; mã nguồn, comment chú thích và `AGENTS.md` dùng
tiếng Anh. Quy tắc đầy đủ nằm ở
[AGENTS.md → Language convention](../AGENTS.md#language-convention).

Hệ quả thực tế: `frontend/app/layout.tsx` đặt `<html lang="vi">` và mọi font
Google đều khai báo `"vietnamese"` trong `subsets`, nếu không dấu tiếng Việt sẽ
hiển thị thành ô vuông.

## Giới hạn số dòng

| Phần mở rộng | Trần | Thực thi bởi |
| --- | --- | --- |
| `.py` | 400 dòng | `scripts/check-file-size.mjs` + job `file-size` của CI |
| `.tsx` | 260 dòng | như trên |
| `.ts` | 350 dòng | như trên |

Trần và các ngoại lệ nằm trong `scripts/file-limits.config.json`. Xem
[AGENTS.md](../AGENTS.md#file-size-limits) để biết cách tách một file khi nó
vượt trần.

## Thêm một tính năng, từ đầu đến cuối

1. Backend: logic thuần trong `domain/`, kèm unit test, rồi route trong `api/`,
   rồi một integration test chạy trên app thật.
2. Nếu hình dạng response là mới, thêm regression test ghim lại tập key.
3. Frontend: hàm trợ giúp trong `lib/` kèm unit test, component trong
   `components/` kèm integration test, route trong `app/`.
4. Nếu luồng UI người dùng nhìn thấy được, thêm một spec e2e trong `tests/e2e/`.
5. Cập nhật [development.md](development.md) nếu bạn thêm biến môi trường hoặc
   lệnh mới.
6. Chạy toàn bộ kiểm tra trong
   [development.md](development.md#chạy-toàn-bộ-kiểm-tra).
