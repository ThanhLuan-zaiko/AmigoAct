# Kiến trúc

## Hình dạng tổng thể

```
┌──────────────────────────────────────────────────────────┐
│  frontend/  Next.js 16 App Router  (React 19, Bun)        │
│                                                          │
│   app/          route — shell server component + view     │
│   components/   provider (theme/auth/realtime) + UI       │
│   lib/          hàm trợ giúp không phụ thuộc framework     │
└───────────────┬───────────────────────┬──────────────────┘
                │  HTTPS  /api/*        │  WebSocket /api/ws
┌───────────────▼───────────────────────▼──────────────────┐
│  backend/  FastAPI  (Python 3.14, uv)                    │
│                                                          │
│   api/routers/   bề mặt HTTP mỏng                         │
│   api/schemas/   request/response contract (pydantic)     │
│   api/           deps (auth), errors (→ status), events   │
│   services/      unit-of-work: query → commit → events    │
│   domain/        logic nghiệp vụ thuần  ← unit test       │
│   db/            ORM models + custom types + session      │
│   database.py    pool oracledb → AsyncEngine → session    │
│   websocket.py   /api/ws + ConnectionManager              │
│   security.py    argon2id + JWT                           │
│   config.py      cấu hình đọc từ môi trường              │
│   main.py        app factory + lifespan                   │
└───────────────────────┬──────────────────────────────────┘
                        │  pool.acquire (thin driver)
┌───────────────────────▼──────────────────────────────────┐
│  Oracle Database (gvenzl/oracle-free) — backend/schema.sql│
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
| `backend/src/backend/domain/` | thư viện chuẩn, `backend.domain.*` | `fastapi`, `starlette`, `pydantic`, `sqlalchemy`, `backend.api`, `backend.db`, `backend.services`, `backend.config` |
| `backend/src/backend/db/` | `sqlalchemy`, `backend.domain`, `backend.config` | `fastapi`, `backend.api`, `backend.services` |
| `backend/src/backend/services/` | `sqlalchemy`, `backend.db`, `backend.domain`, `backend.config` | `fastapi`, `backend.api`, `backend.websocket` |
| `backend/src/backend/api/` | `backend.services`, `backend.domain`, `backend.db`, `backend.config`, `backend.websocket`, `fastapi` | — |
| `frontend/lib/` | thư viện chuẩn, module `lib/` khác | `next/*`, `react`, `react-dom` |
| `frontend/components/` | `react`, `@tanstack/react-query`, `@/lib/*` | nội bộ server của `next/*` |
| `frontend/app/` | `next/*`, `@/components/*`, `@/lib/*` | — |

Logic nghiệp vụ mà biết đến HTTP thì không thể test mà không cần dựng request
object. Giữ nó không phụ thuộc framework chính là thứ làm cho tầng unit đủ nhanh
để chạy ở mỗi lần gõ phím.

## Vòng đời một request (backend)

1. `uvicorn` nhận một `scope` ASGI rồi gọi `app`. `lifespan` (chạy một lần khi
   boot) dựng pool Oracle → engine → sessionmaker cùng `ConnectionManager`,
   đặt tất cả lên `app.state`, và fail ngay nếu `verify_pool` không ping
   được DB.
2. Router của FastAPI đối chiếu path với các tiền tố đã đăng ký trong
   `create_app()` (`settings.api_prefix` cộng với tiền tố riêng của từng router).
3. Dependency chạy trước handler: `get_session` mở một `AsyncSession`
   request-scope; `get_current_user` (mọi route cần auth) giải mã
   `Authorization: Bearer <jwt>` thành row `User`, hoặc ném
   `AuthenticationError` → `401`.
4. Handler gọi một hàm `services/*`. Service là **unit-of-work**: nó sở hữu
   authorization (ai được làm gì trong org nào), gọi rule thuần trong
   `domain/` (ném `DomainError`), commit transaction, và trả về
   `(result, events)` — `events` là các `DomainEvent` mô tả thay đổi.
5. Handler đẩy `events` qua `api/events.publish_events` — **sau** commit, nên
   client không bao giờ nghe về một thay đổi còn có thể rollback.
6. Handler map row ORM sang `api/schemas/*` một cách tường minh — mọi
   relationship khai báo `lazy="raise"`, nên serialize ORM trực tiếp sẽ fail
   rõ thay vì ngầm phát query ngoài event loop.
7. Ngoại lệ: `DomainError` → `{"detail","code"}` với status theo
   [bảng dưới](#hợp-đồng-lỗi); `ValueError` → `422 {"detail": ...}`; còn lại
   → `500`.

`create_app()` trả về một application **mới** mỗi lần gọi. Biến `app` ở cấp
module chỉ là một instance đã dựng sẵn cho uvicorn. Test dựng instance riêng, và
đó là lý do override được biến môi trường.

### Luồng ví dụ: điểm danh bằng mã

`POST /api/activities/{id}/checkin` với body `{"code": "KM2P4R"}`:

1. `get_current_user` → `User`; `get_session` → session.
2. `services.checkin.checkin_by_code` khoá row activity (`with_for_update`),
   kiểm tra theo thứ tự có chủ đích: activity đang `published` → mã khớp
   (`hmac.compare_digest`) → đang trong khung giờ điểm danh (mở 60 phút trước
   `starts_at`, đến `ends_at`) → đăng ký của member ở `approved`.
3. Đặt `checked_in_at`, commit, đếm lại số người đã điểm danh.
4. Phát `checkin.recorded` tới staff của org + chính member đó.
5. `RealtimeProvider` phía client nhận push → `realtimeInvalidations` →
   invalidate `qk.activityRegs`/`qk.activity`/`qk.reports`/`qk.orgMembers` →
   màn hình quản lý và trang hoạt động tự cập nhật, không poll.

Điểm danh lặp lại là idempotent: `already_checked_in=True`, không đổi
`checked_in_at`, không phát event thứ hai. Manager ở cửa có đường riêng
`POST /api/registrations/{id}/checkin` — bỏ qua mã và khung giờ mở sớm nhưng
vẫn đòi `approved` + `published`.

## Tầng dữ liệu: pool → engine → session

Query ORM và checkout thô dùng **cùng một** `oracledb.AsyncConnectionPool`
tạo trong `lifespan` (`database.py`):

1. `create_pool` mở `oracledb.create_pool_async(...)` với
   `session_callback=_pin_utc_session`: mỗi session vật lý mới chạy
   `ALTER SESSION SET TIME_ZONE = '+00:00'` đúng một lần lúc tạo pool,
   không phải mỗi checkout.
2. `create_engine_for_pool` dựng `create_async_engine("oracle+oracledb://",
   async_creator=pool.acquire, poolclass=NullPool)` — SQLAlchemy **không**
   pool thêm; `session.close()` trả connection thẳng về pool oracledb.
3. `db/session.create_sessionmaker` bọc engine thành
   `async_sessionmaker(expire_on_commit=False)` — mọi cột được gán phía
   Python nên không cần refresh sau commit (vốn đòi hỏi một round-trip
   `RETURNING` khó xử trong async).
4. Router nhận session qua dependency `database.get_session` (một session
   mỗi request). `app.state.db_pool` / `db_engine` / `db_sessionmaker` là
   điểm tra cứu; `AMIGOACT_DB_ENABLED=false` để chúng `None` và app boot
   không DB (test dùng cờ này).

## Quan hệ n-m: đoàn viên ⇄ hoạt động

Quan hệ nhiều-nhiều trung tâm của bài toán — một đoàn viên (sinh viên) tham
gia nhiều hoạt động, một hoạt động có nhiều đoàn viên — được mô hình hoá
bằng **association object** `activity_registrations` chứ không phải bảng
join thuần, vì đăng ký mang theo dữ liệu riêng mà join thuần không chứa
được: `status` (`pending → approved/rejected`, hoặc `cancelled` bởi member),
`note`, `checked_in_at`, `reviewed_by`/`reviewed_at`.

Hai đầu relationship lộ ra qua `association_proxy`:

```python
member.activities    # các hoạt động đoàn viên đã đăng ký
activity.members     # các đoàn viên đã đăng ký hoạt động
```

Phân vai: `db/models/` khai báo mapping + index (`uq_registrations`
unique `(activity_id, member_id)`); `domain/registrations.py` giữ rule
(`decide_register`, `checkin_eligible`, `may_cancel`, capacity — pending
*và* approved đều chiếm chỗ); `services/` thực thi. Mọi relationship đều
`lazy="raise"` + `AsyncAttrs`: một implicit lazy load là lỗi rõ ràng chứ
không phải query lén ngoài event loop.

`volunteer_records` là ghi nhận thành tích cuối cùng — thường sinh từ đăng
ký đã điểm danh khi activity `complete`, nhưng `activity_id` nullable để
ghi hoạt động ngoài hệ thống (`services/record_admin.py`).

## Chính sách thời gian

- **UTC khắp nơi.** Timestamp phía Python luôn aware UTC. Driver thin trả
  `TIMESTAMP WITH TIME ZONE` dạng *naive* và hiểu bind naive theo giờ
  session — nên session Oracle được pin UTC (xem trên), và
  `db/types.UtcDateTime` bind aware → naive-UTC rồi gắn lại `tzinfo=utc`
  khi đọc. Datetime naive bị từ chối hẳn bằng `ValueError`.
- **Ba TypeDecorator** trong `db/types.py` là cầu nối duy nhất giữa
  `schema.sql` và Python: `Uuid` (`RAW(16)` ⇄ `uuid.UUID`),
  `UtcDateTime` (TSTZ ⇄ aware UTC), `DecimalAmount` (`NUMBER(6,2)` ⇄
  `Decimal`; trên SQLite lưu integer hundredths vì không có fixed-point).
- **Ngày theo giờ nghiệp vụ.** `AMIGOACT_TIMEZONE` (IANA, mặc định
  `Asia/Ho_Chi_Minh`) quyết định "một thời điểm rơi vào ngày nào":
  `volunteer_records.awarded_on`, ngày cấp/ngày tham gia trên chứng nhận,
  lọc `from`/`to` của báo cáo. `db/base.business_today()` là điểm lấy
  "hôm nay" duy nhất; package `tzdata` cung cấp database IANA trên Windows.

## Sự kiện realtime

Service không đụng socket: nó trả `DomainEvent(type, data, user_ids)`, còn
`api/events.publish_events` đẩy envelope `{"type","data"}` qua
`ConnectionManager.send_to_users`. Manager index socket theo JWT `sub`, nên
event tới "user này trên mọi tab đang mở". Phía client,
`realtimeInvalidations` (`frontend/lib/realtime-events.ts`) map type → các
`qk.*` cần invalidate.

| `type` | `data` | Ai nhận |
| --- | --- | --- |
| `activity.changed` | `org_id`, `activity_id`, `activity_status` | staff của org |
| `registration.changed` | `org_id`, `activity_id`, `registration_id`, `member_id`, `status` | staff + member đó |
| `checkin.recorded` | `org_id`, `activity_id`, `registration_id`, `member_user_id`, `member_full_name`, `checked_in_at`, `checked_in_count` | staff + member đó |
| `record.changed` | `org_id`, `activity_id`, `record_id`, `member_id`, `title`, `hours`, `points`, `awarded_on` | staff + member đó |

`data` đi vào đã JSON-ready (UUID→`str`, datetime→ISO, Decimal→`str`). Cả
bốn chuỗi `type` lẫn tập key là hợp đồng đóng băng — ghim bởi
`tests/regression/test_ws_contract.py` (backend) và
`tests/regression/realtime-contract.test.ts` (frontend). "Staff" nghĩa là
`manager`/`admin` đang `active` có `user_id` (`org_staff_user_ids`).

Protocol của chính socket — envelope `{"type","data"}`, `hello`, `ping`/
`pong`, `error`, đóng `4401` khi token sai/thiếu — nằm ở `websocket.py`.
Type inbound mới (client → server) được mở rộng qua `_dispatch`; không mở
endpoint thứ hai.

## Hợp đồng lỗi

Mọi lỗi nghiệp vụ là một `domain.errors.DomainError` mang `detail` tiếng
Anh (chẩn đoán cho lập trình viên, theo quy ước ngôn ngữ) + `code` máy-đọc
mà client switch theo. `api/errors.py` map subclass → status:

| Exception | HTTP | Ví dụ `code` |
| --- | --- | --- |
| `AuthenticationError` | 401 | `missing_token`, `token_invalid`, `account_disabled` |
| `PermissionDeniedError` | 403 | `not_a_member`, `insufficient_role` |
| `NotFoundError` | 404 | `activity_not_found`, `record_not_found` |
| `ConflictError` | 409 | `already_registered`, `activity_full`, `last_admin` |
| `RuleViolationError` | 422 | `invalid_email`, `invalid_code`, `invalid_status` |

Body luôn là `{"detail": str, "code": str}`; 401 kèm header
`WWW-Authenticate: Bearer`. `ValueError` thuần vẫn ra `422 {"detail": ...}`
như trước, và validation của FastAPI giữ dạng `{"detail": [...]}` —
frontend gom nó thành code `validation_error`. UI không bao giờ hiển thị
`detail` trần: `frontend/lib/errors.ts` dịch `code` sang tiếng Việt, code
lạ rơi về thông báo chung.

## Chứng nhận PDF

`GET /api/records/{id}/certificate` trả `application/pdf` dạng attachment
(`chung-nhan-<id>.pdf`, `Cache-Control: private, no-store`). Pipeline hai
bước trong `services/certificates.py`:

1. `get_record_for_certificate` resolve row thành `CertificateContext` đã
   được **uỷ quyền sẵn**: chỉ chủ nhân record (`member.user_id` khớp
   caller) hoặc staff (manager/admin) của org chứa record mới qua được.
2. `render_certificate_pdf` vẽ một trang A4 từ đúng context đó bằng `fpdf2`
   — renderer không tự consult dữ liệu nào khác. Font Be Vietnam Pro bundle
   sẵn trong `src/backend/assets/fonts/` (giấy phép OFL) nên dấu tiếng Việt
   render đúng trên mọi máy; text đi qua chuẩn hoá NFC trước khi in.

## Cấu hình và bộ nhớ đệm

`Settings` là model `pydantic-settings`, được đọc đúng một lần qua một singleton
`lru_cache`. Chính bộ nhớ đệm đó là lý do `tests/conftest.py` cung cấp fixture
`build_app(**env)` thay vì yêu cầu test gọi `monkeypatch.setenv` rồi dùng lại
app đã dựng — app đó đã nắm giá trị trước khi override.

Đọc cấu hình: `get_settings()`. Ép đọc lại: `reset_settings_cache()`.

## Luồng dữ liệu (frontend)

App Router mặc định dùng **server component**: mỗi `page.tsx` là một shell
mỏng (metadata + `<RequireAuth>` + `<Suspense>` khi cần), còn view tương tác
là client component bên cạnh (`*-view.tsx`). Một component trở thành client
component chỉ khi khai báo `"use client"` ở đầu file — làm vậy khi và chỉ khi
nó cần state, effect hoặc event handler. Chỉ `/`, `/login`, `/register` là
công khai — mọi route còn lại đứng sau `RequireAuth`, anonymous bị đẩy về
`/login?next=<path>`.

Fetch phía client **chỉ** đi qua TanStack Query (`useQuery`/`useMutation`),
key lấy từ registry đóng băng `lib/query-keys.ts` (`qk`) — một key là một
prefix, nên invalidate `["activity-regs", id]` bắt cả biến thể đang filter
theo status. Không `useEffect` fetch tự do. Token JWT (`localStorage` key
`amigoact-token`, qua `lib/auth-storage.ts`) được `lib/api.ts` gắn vào
header `Authorization`; một `401` trên request có token kích hook logout.

Trạng thái "live" không fetch lại bằng tay: `RealtimeProvider` mở socket
`/api/ws?token=<jwt>` khi đã authenticated và map mỗi envelope qua
`realtimeInvalidations` → `queryClient.invalidateQueries`. Đó là nửa sau
của xương sống realtime mô tả ở [Sự kiện realtime](#sự-kiện-realtime);
nửa đầu là Speculation Rules (`<SpeculationRules>` + `<Link>` prefetch)
giữ điều hướng tức thì.

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
| Toàn bộ tập path trong OpenAPI | `main.py` + `api/routers/` | `backend/tests/regression/test_api_contract.py` |
| Envelope lỗi `{detail, code}` + map status | `domain/errors.py`, `api/errors.py` | `test_api_contract.py` (backend); `api-contract.test.ts` ghim `API_ERROR_MESSAGES` phủ mọi code |
| 4 `type` event + tập key `data` | `services/events.py` | `test_ws_contract.py` (backend), `realtime-contract.test.ts` (frontend) |
| Mã điểm danh: alphabet 31 ký tự, dài 6, mở sớm 60' | `domain/checkin.py`, `domain/activities.py` | `api-contract.test.ts` (`lib/checkin.ts` mirror) |
| Đóng socket `4401` khi auth fail | `websocket.py` | `realtime-contract.test.ts` |
| Header chứng nhận PDF + `%PDF` | `api/routers/records.py` | `test_api_contract.py` |
| `schema.sql` ⇄ ORM metadata (tập cột) | `db/models/` | `test_schema_drift.py` |
| Tập giá trị status/role + nhãn tiếng Việt | `schema.sql` CHECK, `domain/*` | `api-contract.test.ts` (`lib/labels.ts`, `lib/types.ts` mirror) |

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

1. Backend: rule thuần trong `domain/` kèm unit test. Nếu chạm DB: sửa
   `schema.sql` + `db/models/` + `MAPPED_TABLES` trong `test_schema_drift.py`
   cùng một commit, rồi `reset_database.ps1` để áp lên Oracle.
2. Nghiệp vụ có transaction vào `services/` — commit bên trong, trả
   `(result, events)`; route mỏng trong `api/routers/` + schema trong
   `api/schemas/`; một integration test chạy trên app thật (fixture `db_client`).
3. Nếu hình dạng response hoặc event là mới, ghim nó trong regression test
   (tập key OpenAPI, `test_ws_contract.py`, hoặc `realtime-contract.test.ts`).
4. Frontend: hàm trợ giúp trong `lib/` kèm unit test (type mirror trong
   `lib/types.ts`, query key trong `lib/query-keys.ts`, invalidate map trong
   `lib/realtime-events.ts` nếu có event mới), component trong `components/`
   kèm integration test, route trong `app/`.
5. Nếu luồng UI người dùng nhìn thấy được, thêm một spec e2e trong `tests/e2e/`.
6. Cập nhật [development.md](development.md) nếu bạn thêm biến môi trường hoặc
   lệnh mới.
7. Chạy toàn bộ kiểm tra trong
   [development.md](development.md#chạy-toàn-bộ-kiểm-tra).
