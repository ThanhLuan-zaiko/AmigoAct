# Đóng góp

Cảm ơn bạn đã giúp. Tài liệu này nói về quy trình; các quy tắc ràng buộc bản
thân mã nguồn nằm ở [`AGENTS.md`](AGENTS.md).

Mới tham gia repo? Bắt đầu với [`docs/development.md`](docs/development.md) để
chạy được dự án, rồi đọc [`AGENTS.md`](AGENTS.md) trước thay đổi đầu tiên.

## Cài đặt

```bash
git clone <repo-url> && cd amigoact

cd backend  && uv sync --all-groups && cp .env.example .env
cd frontend && bun install && cp .env.example .env
```

## Nhánh

```
<type>/<short-description>     feat/greeting-card
                              fix/stale-settings-cache
                              docs/testing-layers
                              chore/bump-next
```

`type` là một trong `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`,
`build`, `perf`. Dùng `/` để nhóm mô tả nhiều từ bằng dấu gạch nối.

Nhánh phải bắt nguồn từ `main` đã cập nhật:

```bash
git switch main && git pull --ff-only
git switch -c feat/greeting-card
```

## Commit

[Conventional Commits](https://www.conventionalcommits.org/), được kiểm tra trên
tiêu đề PR và áp dụng cho commit message:

```
feat(backend): add readiness endpoint returning {"status": "ready"}
fix(frontend): reset settings cache before building the app in tests
test: pin the health response key set
docs(ci): document how to debug a red e2e job
refactor: extract domain logic out of the health router
chore(deps): bump vitest to 3.2.7
```

Nguyên tắc:

- Một thay đổi lôgic trong mỗi commit; một đợt refactor không đi kèm tính năng.
- Bản sửa lỗi và regression test của nó nằm trong **cùng** một commit.
- Viết subject ở thể mệnh lệnh: "add", không phải "added" hay "adds".
- `BREAKING CHANGE:` ở footer, sau đó một dòng trống, rồi mô tả.

Lệnh hữu ích:

```bash
git commit -m "feat(backend): add readiness endpoint"
git commit --fixup <sha> && git rebase -i --autosquash origin/main
```

## Pull request

Giữ cho nhỏ. Một diff 400 dòng sẽ được review thật; một diff 2.000 dòng sẽ bị
trả lại với lý do "xin tách ra". Giới hạn số dòng tồn tại vì lý do đó.

Trước khi mở:

```bash
cd backend  && uv run ruff check . && uv run mypy && uv run pytest && cd ..
cd frontend && bun run check && cd ..
bun run scripts/check-file-size.mjs
```

Điền mẫu PR trung thực — nhất là phần **"Đã kiểm chứng thế nào"** và **"Tầng kiểm
thử đã đụng tới"**. Một ô đã tick mà thực tế chưa chạy còn tệ hơn ô để trống.

Người review sẽ kiểm tra, theo thứ tự này:

1. **Có đúng không?** Đặc biệt là các trường hợp biên — rỗng, một, đúng trần,
   trần + 1.
2. **Có mock data nào lọt vào code chạy thật không?** Mảng record hardcode, số liệu
   bịa, route trả dữ liệu giả, hay lỗi bị nuốt rồi thay bằng kết quả rỗng để
   "cho đẹp". Placeholder gợi ý thì không tính. Đây là lý do từ chối phổ biến
   nhất. Xem [AGENTS.md → No mock data](AGENTS.md#no-mock-data).
3. **Đã test đúng tầng chưa?** Endpoint mới cần integration test; hàm thuần mới
   cần unit test; hành vi đã phát hành bị đổi thì cần regression test.
4. **Regression test có fail trước bản sửa không?** Hỏi ra nếu không rõ.
5. **Có file nào vượt trần không?** Phần tách có theo đúng ranh giới không?
6. **Có hạ ngưỡng nào không?** Một diff hạ `--cov-fail-under` hoặc ngưỡng Vitest
   để cho PR pass sẽ bị trả lại.
7. **Có suppression mới không?** `# type: ignore`, `# noqa`, `biome-ignore`,
   `as any` — mỗi cái cần một lý do trong comment.
8. **Tài liệu còn khớp không?** Lệnh, biến môi trường, endpoint, quy tắc.

Comment review nên nói **cái gì** và **tại sao**, và phân biệt phần chặn với phần
tuỳ chọn. Ghi tiền tố `nit:` cho góp ý tuỳ chọn để tác giả có thể bỏ qua.

## Hoàn thành

- [ ] Có test ở đúng tầng; bản sửa lỗi kèm regression test fail trước đó
- [ ] **Không có mock data, placeholder hay record bịa nào ngoài bộ test**
- [ ] `ruff`, `ruff format --check`, `mypy` sạch
- [ ] `biome check`, `tsc --noEmit` sạch
- [ ] Vẫn đạt ngưỡng coverage
- [ ] Không file nào vượt trần số dòng
- [ ] Thay đổi UI đã kiểm bằng `bun run e2e`
- [ ] Đã cập nhật tài liệu cho lệnh, biến môi trường, endpoint hoặc quy tắc mới
- [ ] Đã commit lockfile nếu có đổi dependency
- [ ] Không có bí mật nào trong diff

## Cấm mock data

Không được có mock, fake hay record hardcode trong bất kỳ code path nào chạy ngoài
bộ test. Người dùng không bao giờ được thấy màn hình chứa dữ liệu không đến từ
hệ thống thật.

Nếu backend chưa sẵn sàng, hãy trả về trạng thái thật: collection rỗng kèm UI
empty-state, hoặc một lỗi có kiểu rõ ràng. Tuyệt đối không bịa một record để lấp
chỗ trống.

**Placeholder gợi ý thì vẫn được** — `placeholder="Nhập tên"`, hint dưới ô nhập,
tooltip, ví dụ định dạng, hay empty-state hướng dẫn người dùng làm gì tiếp theo.
Ranh giới: placeholder *chỉ người dùng* thì được; placeholder *giả làm dữ liệu
thật* thì không.

Danh sách đầy đủ những gì bị cấm và cách làm thay thế nằm ở
[AGENTS.md → No mock data](AGENTS.md#no-mock-data). Mock trong test suite là đúng
đắn, không phải ngoại lệ.

## Báo cáo lỗi

Dùng mẫu issue **Bug report**. Phần giá trị nhất là các bước tái hiện — lý tưởng
nhất là một test fail. Nếu bạn viết được regression test fail trên `main` thì bạn
đã làm xong nửa việc sửa, và người review có thể kiểm chứng nửa còn lại.

Về vấn đề bảo mật, đừng mở issue công khai. Dùng liên kết báo cáo riêng tư
trong [`.github/ISSUE_TEMPLATE/config.yml`](.github/ISSUE_TEMPLATE/config.yml).

## Thêm dependency

Phải có lý do, và phải có trong lockfile ngay PR đó.

**Backend** — dependency runtime nằm trong `[project.dependencies]`; dependency
test và công cụ nằm trong dependency group `dev`. Chạy `uv add <pkg>` hoặc
`uv add --dev <pkg>`; không bao giờ sửa tay phần dependencies trong
`pyproject.toml`.

**Frontend** — runtime trong `dependencies`, công cụ trong `devDependencies`. Chạy
`bun add <pkg>` hoặc `bun add -d <pkg>`; không bao giờ sửa tay phần dependencies
trong `package.json`.

Một PR thêm dependency nên nói rõ nó thay thế cái gì, vì sao thư viện chuẩn hoặc
dependency sẵn có chưa đủ, và chi phí bảo trì lẫn bundle size ra sao. Chia lý do
thành gạch đầu dòng giúp người review hơn nhiều.

## Ngôn ngữ

| Bề mặt | Ngôn ngữ |
| --- | --- |
| Nội dung người dùng đọc trên web | Tiếng Việt |
| Mọi file `.md` (trừ `AGENTS.md`) | Tiếng Việt |
| `AGENTS.md` | Tiếng Anh |
| Mã nguồn, định danh, tên hàm, tên test | Tiếng Anh |
| Comment chú thích và docstring | Tiếng Anh |
| Tên commit, tiêu đề PR, tên nhánh | Tiếng Anh |

Chi tiết ở [AGENTS.md → Language convention](AGENTS.md#language-convention).

## Quy tắc ứng xử

Nói thẳng và thân thiện. Giả định người khác có năng lực và đang hành động vì lý
do tốt. Review code, không review con người.
