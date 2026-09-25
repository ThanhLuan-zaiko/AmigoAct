# Tích hợp liên tục (CI)

Tất cả workflow nằm trong `.github/workflows/`. Mỗi workflow đều dùng
`permissions:` theo nguyên tắc đặc quyền tối thiểu, đặt `timeout-minutes` tường
minh, và có một `concurrency` group để một lần push mới hủy lần chạy cũ không
còn ý nghĩa.

| Workflow | Kích hoạt | Mục đích |
| --- | --- | --- |
| [`ci.yml`](../.github/workflows/ci.yml) | push / PR vào `main` | Pipeline bắt buộc |
| [`codeql.yml`](../.github/workflows/codeql.yml) | push / PR / hằng tuần | Quét bảo mật, Python + JS/TS |
| [`pr-title.yml`](../.github/workflows/pr-title.yml) | PR mở / sửa | Kiểm tra tiêu đề theo Conventional Commits |
| [`labeler.yml`](../.github/workflows/labeler.yml) | PR mở / cập nhật | Gán nhãn tự động |
| [`stale.yml`](../.github/workflows/stale.yml) | mỗi đêm | Đóng issue và PR không hoạt động |

## Pipeline bắt buộc

`ci.yml` có năm job. `ci-success` là job duy nhất mà branch protection cần
bắt buộc, nên chỉ có đúng một quy tắc cần cấu hình.

```
file-size ──┐
            ├──> ci-success
backend ────┤
            │
frontend ───┼──> e2e ──┘
            │
            └────────────> ci-success
```

### `file-size`

Chạy kiểm tra trần số dòng trên toàn repo, rồi chạy lại trên các file đã staged.
Không cài dependency nào — script chỉ dùng thư viện chuẩn của Node nên job này
xong trong vài giây và báo cáo trước khi các job tốn kém kịp làm gì.

```bash
bun run scripts/check-file-size.mjs
bun run scripts/check-file-size.mjs --staged
```

**Fail nghĩa là** có một `.py` vượt 400 dòng, một `.tsx` vượt 260, hoặc một `.ts`
vượt 350. Hãy tách file — xem
[AGENTS.md → File size limits](../AGENTS.md#file-size-limits). Script in ra mức
sử dụng của từng file, nên nó cảnh báo từ mốc 90% để bạn biết trước khi va
tường.

### `backend`

| Bước | Lệnh | Cổng chặn |
| --- | --- | --- |
| Cài đặt | `uv sync --all-groups --frozen` | lockfile phải cập nhật |
| Lint | `uv run ruff check --output-format=github .` | annotation hiện ngay trong diff của PR |
| Format | `uv run ruff format --check .` | định dạng khớp `ruff format` |
| Kiểu | `uv run mypy` | `strict = true` |
| Unit | `uv run pytest -m unit -q --no-cov` | |
| Tích hợp | `uv run pytest -m integration -q --no-cov` | |
| Hồi quy | `uv run pytest -m regression -q --no-cov` | |
| Coverage | `uv run pytest --cov-report=xml --cov-report=lcov` | ≥ 80% |
| Artifact | `backend-coverage` | giữ 14 ngày |

Ba tầng được chạy riêng **rồi** chạy lại toàn bộ. Chạy riêng giúp quy kết một
lỗi thuộc đúng tầng nào; lần chạy toàn bộ mới là nơi áp cổng coverage. Cờ
`--frozen` làm build fail nếu `uv.lock` lỗi thời, nên một lần quên chạy
`uv lock` không bao giờ lọt tới `main`.

Python được ghim ở `3.14`, khớp với `backend/.python-version`.

### `frontend`

| Bước | Lệnh | Cổng chặn |
| --- | --- | --- |
| Cài đặt | `bun install --frozen-lockfile` | lockfile phải cập nhật |
| Lint | `bun run lint` | biome check |
| Kiểu | `bun run typecheck` | `tsc --noEmit` |
| Unit | `bun run test:unit` | |
| Tích hợp | `bun run test:integration` | |
| Hồi quy | `bun run test:regression` | |
| Coverage | `bun run test:coverage` | ≥ 80% ở cả bốn chỉ số |
| Build | `bun run build` | build production phải thành công |
| Artifact | `frontend-coverage` | giữ 14 ngày |

`bun run build` là một cổng chặn thật, không phải nghi thức: một trang có thể qua
kiểm tra kiểu mà vẫn fail lúc prerender, và lỗi đó phải xuất hiện ở PR chứ
không phải lúc deploy.

### `e2e`

Chạy Playwright trên một bản build **production** bằng Chromium, ở cổng `3100`.
`playwright.config.ts` tự khởi động và dừng server qua `webServer`.

| Bước | Ghi chú |
| --- | --- |
| `bun install --frozen-lockfile` | |
| Cache `~/.cache/ms-playwright` | khoá theo `frontend/bun.lock` |
| `bun run e2e:install` | Chromium + thư viện hệ thống |
| `bun run e2e` | retry hai lần, một worker trong CI |
| Upload `playwright-report` | luôn, 14 ngày |
| Upload `test-results` | chỉ khi fail, 7 ngày (trace, ảnh chụp, video) |

Trace được ghi ở chế độ `on-first-retry`, nên một lỗi chỉ xuất hiện ở lần thử
thứ hai vẫn bị bắt. Nếu job fail, tải `playwright-traces` rồi chạy
`bunx playwright show-trace <file>` để xem từng bước.

**Một e2e test bị flaky là một bug.** Không thêm `test.skip` để cho nó xanh.

### `ci-success`

Tổng hợp bốn job và là check duy nhất cần đánh dấu bắt buộc trong branch
protection. Job dùng `if: always()` nên vẫn báo cáo được khi một job phía trên bị
skip hoặc cancel.

## Branch protection

Cấu hình khuyến nghị cho `main`:

- Bắt buộc có pull request; 1 lượt duyệt; bỏ duyệt khi push lại.
- **Bắt buộc status check**, chỉ chọn `CI`.
- Yêu cầu nhánh phải cập nhật trước khi merge.
- Yêu cầu resolve hết thảo luận.
- Chặn force push và xoá nhánh.

Thiết lập:

```bash
gh api -X PATCH repos/:owner/:repo/branches/main/protection \
  -F 'required_status_checks[strict]=true' \
  -f 'required_status_checks[contexts][]=CI' \
  -F 'required_pull_request_reviews[required_approving_review_count]=1' \
  -F 'required_pull_request_reviews[dismiss_stale_reviews]=true' \
  -F 'enforce_admins=true' \
  -F 'restrictions=null' \
  -F 'allow_force_pushes=false' \
  -F 'allow_deletions=false'
```

## CodeQL

`codeql.yml` quét cả hai ngôn ngữ ở mỗi lần push và PR vào `main`, cộng thêm một
lần chạy định kỳ hằng tuần để bắt các thông báo bảo mật xuất hiện sau đó. Kết
quả nằm ở **Security → Code scanning**. Kết quả này không chặn gì — hãy xử lý
như bug.

## Dependabot

`dependabot.yml` bao phủ GitHub Actions, `uv` (`/backend`) và `npm` (`/frontend`,
qua `bun.lock`). Các bản cập nhật được gom lại để một lần chạy hằng tuần không
mở ba mươi PR:

- Actions: `actions/*`, `astral-sh/*`, `oven-sh/*`, `github/codeql-action/*`, cộng
  một nhóm minor + patch.
- Python: minor + patch gom một nhóm, major tách riêng.
- Node: `framework` (next/react/react-dom/typescript), `testing`, `linting`, và
  toàn bộ bản patch.

Nhóm framework và testing là cố ý — một bản minor của Next.js thường cần đúng
phiên bản React đi kèm, nên chúng phải đi cùng nhau.

## Debug khi build đỏ

**Hãy chạy lại local trước.** Pipeline chạy đúng những lệnh bạn chạy được:

```bash
cd backend  && uv run ruff check . && uv run mypy && uv run pytest
cd frontend && bun run check && bun run e2e
bun run scripts/check-file-size.mjs
```

Sau đó:

| Triệu chứng | Xem ở đâu |
| --- | --- |
| Annotation hiện ngay trong diff của PR | đúng như thiết kế — `ruff` chạy với `--output-format=github` |
| `Required test coverage of 80% not reached` | các dòng thiếu nằm trong bảng phía trên lỗi; hãy thêm test, đừng hạ `--cov-fail-under` |
| `lockfile out of date` | commit lại `uv.lock` / `bun.lock` vừa sinh |
| Chỉ e2e fail trong CI | tải `playwright-traces`; kiểm tra xung đột cổng hoặc giả định về thời gian |
| Chỉ `CI` đỏ mà không có chi tiết | mở job đó — bước "Job results" in kết quả của cả bốn job, và bước ngay dưới sẽ chỉ ra thủ phạm |
| Job CodeQL fail ở PR từ fork | đúng như mong đợi; CodeQL chạy ở chế độ quyền hạn ở đó |

Chạy lại riêng một job mà không cần push gì:

```bash
gh workflow run ci.yml --ref <branch>
```

## Thêm một workflow

- `permissions: contents: read` ở đầu file; chỉ mở rộng theo từng job khi thật
  sự cần.
- Luôn đặt `timeout-minutes`.
- Luôn đặt `concurrency` group.
- Ưu tiên `astral-sh/setup-uv` với `enable-cache: true` thay vì tự dựng cache.
- Cài đặt bằng `--frozen-lockfile` (frontend) hoặc `--frozen` (backend) để CI
  không âm thầm resolve phiên bản khác với cái bạn đã test.
- Upload artifact cho mọi thứ bạn sẽ muốn debug sau này, kèm thời hạn lưu trữ và
  `if-no-files-found: error`.

## Ngôn ngữ trong CI

Tên bước (`name:`) và thông điệp `run` dùng tiếng Anh, vì chúng là bề mặt kỹ
thuật dành cho người đọc log. Đầu ra của log và chẩn đoán từ ruff, mypy, biome,
tsc, pytest, Vitest và Playwright do công cụ sinh ra nên giữ nguyên tiếng Anh.
Quy tắc này nằm ở [AGENTS.md → Language convention](../AGENTS.md#language-convention).
