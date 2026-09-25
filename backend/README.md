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
uv run uvicorn backend.main:app --reload     # http://localhost:8000
uv run uvicorn backend.main:app --reload --port 8100
```

Tài liệu API tương tác: <http://localhost:8000/docs>

## Bố cục

```
src/backend/
├── main.py              # create_app() factory + ASGI `app`
├── config.py            # Settings, đọc từ môi trường và được cache
├── api/routers/         # bề mặt HTTP: route, mã trạng thái, tag
└── domain/              # logic nghiệp vụ thuần — không fastapi, không I/O
tests/
├── conftest.py          # fixture app / client / build_app
├── unit/                # một đơn vị cô lập
├── integration/         # app thật, qua HTTP
└── regression/          # hành vi đã phát hành được ghim lại
```

`domain/` không được import `fastapi`, `starlette` hay `pydantic`. Chính ràng buộc
này giúp tầng unit chạy nhanh. Xem
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

Chi tiết ở [testing.md](../docs/testing.md).

## Endpoint

| Method | Đường dẫn | Ý nghĩa |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness. `{"status", "app", "version", "environment"}` |
| `GET` | `/api/health/ready` | Readiness. `{"status": "ready"}` |
| `GET` | `/api/greeting?name=` | Endpoint demo cho tầng domain |
| `GET` | `/version` | Tên và phiên bản, nằm ngoài tiền tố API |

Tập key chính xác của response được ghim bởi
`tests/regression/test_api_contract.py`. Đổi một key nghĩa là đổi cả test đó
trong cùng một commit.

## Ngôn ngữ

Nội dung người dùng nhìn thấy từ endpoint này là tiếng Việt (`"Xin chào, Lan!"`).
Message lỗi vẫn giữ tiếng Anh vì chúng là chẩn đoán dành cho lập trình viên, và
được ghim bởi regression test. Xem
[AGENTS.md](../AGENTS.md#language-convention).
