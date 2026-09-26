# AmigoAct API

Dịch vụ FastAPI cho AmigoAct. Python 3.14, quản lý bằng
[uv](https://docs.astral.sh/uv/).

Tài liệu chung của toàn repo nằm ở [`../docs`](../docs); file này chỉ là tra
cứu nhanh riêng cho package backend.

## Cài đặt

```bash
uv sync --all-groups
cp .env.example .env
```

Cấu hình được đọc từ `.env` với tiền tố `AMIGOACT_` — xem
[`.env.example`](.env.example) để biết mọi biến.

## Chạy

```bash
uv run uvicorn backend.main:app --reload --port 8100   # http://localhost:8100
```

Port mặc định là **8100**: 8000 bị WSL port relay chiếm (container Portainer
trong WSL map `8000:8000`). Tài liệu API tương tác:
<http://localhost:8100/docs>

## Cơ sở dữ liệu

App kết nối Oracle Database (`gvenzl/oracle-free`) chạy trong Docker trên WSL
bằng driver `python-oracledb` ở chế độ thin — không cần Oracle Instant Client.

Khởi động container (chạy trong WSL):

```bash
docker run -d \
  --name myoracle \
  -p 1521:1521 \
  -e ORACLE_PASSWORD=SysPassword1 \
  -e ORACLE_DATABASE=MyOracleDB \
  -v oracle_data:/opt/oracle/oradata \
  gvenzl/oracle-free
```

WSL forward port của container ra `localhost` của Windows, nên từ Windows
chỉ cần `AMIGOACT_DB_HOST=localhost`. `ORACLE_DATABASE` trở thành tên PDB —
đặt `AMIGOACT_DB_SERVICE` tương ứng (mặc định `MYORACLEDB`; image còn có sẵn
PDB `FREEPDB1`).

Các key cần điền trong `.env` (xem [`.env.example`](.env.example)):

```
AMIGOACT_DB_USER=AMIGOACT                 # schema ứng dụng, được reset tạo ra
AMIGOACT_DB_PASSWORD=<mật khẩu schema>
AMIGOACT_DB_ADMIN_USER=SYSTEM             # hoặc SYS (kết nối AS SYSDBA)
```

Mật khẩu admin **không nằm trong `.env`**: khi reset, script đọc env var
`AMIGOACT_DB_ADMIN_PASSWORD` hoặc hỏi bạn nhập (ẩn ký tự). Nếu `.env` lỡ chứa
key đó, `reset_database.ps1` sẽ cảnh báo và bỏ qua nó.

Pool kết nối được tạo trong lifespan khi `AMIGOACT_DB_ENABLED=true` (mặc
định); app fail ngay lúc khởi động nếu không ping được DB. Một
`AsyncEngine` SQLAlchemy 2.0 được xếp lên **cùng pool đó**
(`async_creator=pool.acquire` + `NullPool`), và mỗi session Oracle vật lý
được pin `TIME_ZONE='+00:00'` một lần lúc tạo (`session_callback`). Router
nhận một `AsyncSession` request-scope qua dependency
`backend.database.get_session` — chi tiết luồng ở
[architecture.md → Tầng dữ liệu](../docs/architecture.md#tầng-dữ-liệu-pool--engine--session).

### Reset schema khi dev

```powershell
.\reset_database.ps1            # có hỏi xác nhận
.\reset_database.ps1 -Force     # bỏ qua xác nhận
```

Script đọc `.env`, kết nối bằng user admin, drop `AMIGOACT_DB_USER` (nếu tồn
tại), tạo lại với đủ quyền rồi áp toàn bộ DDL trong `schema.sql` — kết quả là
một database sạch với đủ bảng và ràng buộc. Chỉ chạy với host local —
`-AllowRemote` nếu thật sự cần, `-SchemaFile` để áp một file DDL khác. Không
cần `docker exec`: driver thin đi qua `localhost:1521`.

Chạy không tương tác (CI/task runner) thì export trước:

```powershell
$env:AMIGOACT_DB_ADMIN_PASSWORD = "..."
.\reset_database.ps1 -Force
```

## Xác thực & kênh realtime

Backend sở hữu toàn bộ cơ chế xác thực — xem `src/backend/security.py`:

- **Mật khẩu** băm bằng **argon2id** (`hash_password`/`verify_password`,
  tham số theo RFC 9106); `password_needs_rehash` phục vụ nâng tham số sau
  này.
- **JWT** bearer do backend phát hành và kiểm tra
  (`create_access_token`/`decode_access_token`, mặc định HS256). Secret đọc
  từ `AMIGOACT_JWT_SECRET` — không có default, helper báo lỗi rõ khi thiếu.
- **ID thực thể** là **UUIDv7** sinh phía app qua `domain/ids.py:new_id()`
  (sắp xếp theo thời gian, không cần sequence); lưu trong Oracle dạng
  `RAW(16)` qua `uuid.bytes`.

Kênh **WebSocket** xương sống nằm ở `src/backend/websocket.py`, mount tại
`ws://localhost:8100/api/ws`. Envelope JSON hai chiều `{"type", "data"}`;
`hello`/`ping`/`error` là type có sẵn, tin client → server mới mở rộng qua
`_dispatch`. `ConnectionManager` trên `app.state.ws_manager` index socket
theo JWT `sub` để `send_to_users` đẩy event tới đúng user trên mọi tab. Khi
`AMIGOACT_JWT_SECRET` được đặt, client phải truyền `?token=<jwt>` hợp lệ,
sai/thiếu sẽ bị đóng với mã `4401`; chưa đặt secret thì chạy anonymous (chỉ
cho dev).

Chiều server → client: service trả `DomainEvent[]` sau khi commit, router
gọi `publish_events` (`api/events.py`) để fan-out. Bốn loại event cố định —
`activity.changed`, `registration.changed`, `checkin.recorded`,
`record.changed` — với payload và danh sách người nhận ở
[architecture.md → Sự kiện realtime](../docs/architecture.md#sự-kiện-realtime).

## Bố cục

```
src/backend/
├── main.py              # create_app() factory + ASGI `app`
├── config.py            # Settings, đọc từ môi trường và được cache
├── database.py          # pool Oracle → AsyncEngine → session, dependency get_session
├── security.py          # argon2id hashing + JWT phát hành/kiểm tra
├── websocket.py         # kênh realtime /api/ws + ConnectionManager
├── api/
│   ├── deps.py          # get_current_user (bearer JWT → User)
│   ├── errors.py        # DomainError → HTTP status, body {detail, code}
│   ├── events.py        # publish_events — đẩy DomainEvent lên WS post-commit
│   ├── routers/         # bề mặt HTTP: health, auth, orgs, activities,
│   │                    #   registrations, records, reports
│   └── schemas/         # contract pydantic request/response
├── db/
│   ├── base.py          # Declarative Base (AsyncAttrs), utcnow/business_today
│   ├── types.py         # Uuid (RAW(16)) / UtcDateTime / DecimalAmount
│   ├── models/          # users, organizations, org_members, activities,
│   │                    #   activity_registrations, volunteer_records
│   └── session.py       # async_sessionmaker(expire_on_commit=False)
├── services/            # unit-of-work: query → domain check → commit →
│   │                    #   trả (result, DomainEvent[]) cho router publish
└── assets/fonts/        # Be Vietnam Pro (OFL) cho chứng nhận PDF
scripts/
└── reset_db.py          # drop & recreate user rồi áp schema.sql — gọi bởi reset_database.ps1
tests/
├── conftest.py          # fixture app / client / build_app / db_* (SQLite)
├── unit/                # một đơn vị cô lập
├── integration/         # app thật, qua HTTP + session SQLite-backed
└── regression/          # hành vi đã phát hành được ghim lại
```

`domain/` không được import `fastapi`, `starlette` hay `pydantic`; `services/`
chứa transaction boundary (commit + trả event), router chỉ map HTTP. Xem
[architecture.md](../docs/architecture.md#quy-tắc-phụ-thuộc).

## Lệnh

| | |
| --- | --- |
| `uv run ruff check .` | lint |
| `uv run ruff check --fix .` | lint + tự sửa |
| `uv run ruff format .` | format |
| `uv run ruff format --check .` | kiểm tra format (CI) |
| `uv run mypy` | kiểm tra kiểu nghiêm ngặt |
| `uv run pytest` | mọi tầng + cổng coverage (≥ 80%) |
| `uv run pytest -m unit` | một tầng |
| `uv run pytest tests/unit/test_greeting.py` | một file |
| `uv run pytest -k "normalize" -q` | một khái niệm |

## Test

Bốn điều cần biết:

- Test được gắn nhãn `unit`, `integration` hoặc `regression`; `--strict-markers`
  nghĩa là gõ sai nhãn sẽ báo lỗi, chứ không âm thầm bị bỏ qua.
- `filterwarnings = ["error"]` — một cảnh báo deprecation mới sẽ làm build fail.
  Hãy sửa nguyên nhân, đừng dập cảnh báo.
- `TestClient` đến từ `starlette`, vốn đã đánh dấu `httpx` là deprecated và yêu
  cầu `httpx2`. Dependency group `dev` dùng `httpx2`; đừng đổi lại.
- `Settings` được cache, nên hãy dùng fixture `build_app(**env)` /
  `build_client(**env)` thay vì `monkeypatch.setenv` cộng với một app đã dựng
  sẵn.
- Test chạm DB dùng fixture `db_client`: pool Oracle tắt, `get_session` bị
  override sang `db_sessionmaker` — SQLite file-backed (`tmp_path`, FK pragma
  bật) — nên không test nào cần listener Oracle thật.
- `db_client` đi kèm argon2id tham số rẻ (`_fast_password_hasher`) để suite
  chạy nhanh; test tham số production nằm riêng ở `tests/unit/test_security.py`.

Chi tiết ở [testing.md](../docs/testing.md).

## Endpoint

Mọi đường dẫn (trừ `/version`) nằm dưới tiền tố `AMIGOACT_API_PREFIX`
(mặc định `/api`). Cột **Auth**: `public` = không cần token; `bearer` = JWT
hợp lệ; `member`/`manager+`/`admin` = bearer + vai trò trong org đó;
`chủ sở hữu` = chính user/member được nói tới.

### `routers/health.py` — tag `health`

| Method | Đường dẫn | Auth | Ý nghĩa |
| --- | --- | --- | --- |
| `GET` | `/api/health` | public | Liveness: `{status, app, version, environment}` |
| `GET` | `/api/health/ready` | public | Readiness |
| `GET` | `/api/greeting?name=` | public | Endpoint demo cho tầng domain |

### `routers/auth.py` — tag `auth`

| Method | Đường dẫn | Auth | Ý nghĩa |
| --- | --- | --- | --- |
| `POST` | `/api/auth/register` | public | Tạo tài khoản → `201` `{access_token, user}` |
| `POST` | `/api/auth/login` | public | `{access_token, user}` |
| `GET` | `/api/auth/me` | bearer | Tài khoản + mọi membership |

### `routers/orgs.py` — tag `orgs`

| Method | Đường dẫn | Auth | Ý nghĩa |
| --- | --- | --- | --- |
| `POST` | `/api/orgs` | bearer | Tạo org; người tạo thành admin → `201` |
| `POST` | `/api/orgs/join` | bearer | Vào org bằng code; claim roster theo `student_code` → `201` |
| `GET` | `/api/orgs/{org_id}` | member | Chi tiết org + membership + stats |
| `GET` | `/api/orgs/{org_id}/members` | manager+ | Roster kèm tổng giờ/điểm |
| `PATCH` | `/api/orgs/{org_id}/members/me` | member | Sửa hồ sơ roster của chính mình |
| `PATCH` | `/api/orgs/{org_id}/members/{member_id}` | admin | Đổi role/status; chặn giáng admin cuối |

### `routers/activities.py` — tag `activities`

| Method | Đường dẫn | Auth | Ý nghĩa |
| --- | --- | --- | --- |
| `GET` | `/api/me/feed` | bearer | Hoạt động sắp/đang diễn ra trong các org của mình |
| `GET` | `/api/me/registrations` | bearer | Đăng ký của mình, mới nhất trước |
| `POST` | `/api/orgs/{org_id}/activities` | manager+ | Tạo activity (draft) → `201` |
| `GET` | `/api/orgs/{org_id}/activities` | member | Liệt kê; member thường không thấy draft |
| `GET` | `/api/activities/{activity_id}` | member | Chi tiết + trạng thái đăng ký của mình; draft trả `404` với member thường |
| `PATCH` | `/api/activities/{activity_id}` | manager+ | Sửa các trường editable |
| `POST` | `/api/activities/{activity_id}/publish` | manager+ | draft → published |
| `POST` | `/api/activities/{activity_id}/cancel` | manager+ | draft/published → cancelled |
| `POST` | `/api/activities/{activity_id}/complete` | manager+ | published → completed + mint volunteer records |
| `POST` | `/api/activities/{activity_id}/checkin-code` | manager+ | Lấy/xoay mã điểm danh |
| `DELETE` | `/api/activities/{activity_id}/checkin-code` | manager+ | Thu hồi mã → `204` |
| `POST` | `/api/activities/{activity_id}/checkin` | member | Điểm danh bằng mã (QR/nhập tay) |
| `GET` | `/api/activities/{activity_id}/registrations` | manager+ | Đăng ký của activity kèm chi tiết member |
| `POST` | `/api/activities/{activity_id}/register` | member | Đăng ký tham gia (pending) → `201` |

### `routers/registrations.py` — tag `registrations`

| Method | Đường dẫn | Auth | Ý nghĩa |
| --- | --- | --- | --- |
| `POST` | `/api/registrations/{registration_id}/cancel` | chủ sở hữu | Huỷ đăng ký pending/approved |
| `POST` | `/api/registrations/{registration_id}/review` | manager+ | Duyệt/từ chối (`{action}`) |
| `POST` | `/api/registrations/{registration_id}/checkin` | manager+ | Điểm danh tay ở cửa |

### `routers/records.py` — tag `records`

| Method | Đường dẫn | Auth | Ý nghĩa |
| --- | --- | --- | --- |
| `GET` | `/api/me/records` | bearer | Record của mình + tổng giờ/điểm + breakdown theo org |
| `GET` | `/api/orgs/{org_id}/members/{member_id}/records` | manager+ | Record của một member trong org |
| `POST` | `/api/orgs/{org_id}/members/{member_id}/records` | manager+ | Ghi nhận giờ/điểm thủ công → `201` |
| `PATCH` | `/api/records/{record_id}` | manager+ | Sửa record (của org mình quản lý) |
| `DELETE` | `/api/records/{record_id}` | manager+ | Xoá record → `204` |
| `GET` | `/api/records/{record_id}/certificate` | chủ sở hữu hoặc manager+ | PDF chứng nhận (`fpdf2`) |

### `routers/reports.py` — tag `reports`

| Method | Đường dẫn | Auth | Ý nghĩa |
| --- | --- | --- | --- |
| `GET` | `/api/orgs/{org_id}/reports/overview` | manager+ | Tổng quan + chuỗi theo tháng + theo khoa + top volunteer; `?from&to` |
| `GET` | `/api/orgs/{org_id}/reports/activities` | manager+ | Phễu đăng ký theo activity; `?from&to` |

### Ngoài router

| Method | Đường dẫn | Auth | Ý nghĩa |
| --- | --- | --- | --- |
| `GET` | `/version` | public | Tên và phiên bản, nằm ngoài tiền tố API |
| `WS` | `/api/ws` | `?token=` khi JWT bật | Kênh realtime, envelope `{"type","data"}` |

Tập key chính xác của response và payload event được ghim bởi
`tests/regression/test_api_contract.py` và
`tests/regression/test_ws_contract.py`. Đổi một key nghĩa là đổi cả test đó
trong cùng một commit.

## Ngôn ngữ

Nội dung người dùng nhìn thấy từ endpoint này là tiếng Việt (`"Xin chào, Lan!"`).
Message lỗi vẫn giữ tiếng Anh vì chúng là chẩn đoán dành cho lập trình viên, và
được ghim bởi regression test. Xem
[AGENTS.md](../AGENTS.md#language-convention).
