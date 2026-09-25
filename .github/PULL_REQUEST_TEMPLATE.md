<!--
Giữ mẫu này ngắn. Mẫu dài sẽ bị bỏ qua; người review cần phần "làm gì" và "làm sao
biết là chạy", không phải bản chép lại nội dung ticket.
-->

## Thay đổi gì

<!-- Một hoặc hai câu. Điều này thay đổi gì cho người dùng sản phẩm? -->

Closes #

## Vì sao

<!--
Vấn đề, không phải lời giải. Link tới issue thay vì dán lại.
Bỏ qua mục này với thay đổi thuần tuý bảo trì.
-->

## Hướng tiếp cận

<!--
Những điều người review không thể suy ra từ diff: một đánh đổi bạn đã chọn, một
phương án khác bạn đã loại, một mẩu dữ liệu bạn phải seed.
-->

## Đã kiểm chứng thế nào

<!--
Tick những gì bạn thực sự đã chạy. Đừng tick những gì bạn chưa chạy.

- [ ] `cd backend && uv run ruff check . && uv run mypy && uv run pytest`
- [ ] `cd frontend && bun run check`
- [ ] `cd frontend && bun run e2e`
- [ ] `bun run scripts/check-file-size.mjs`
-->

## Đã đụng tới tầng kiểm thử nào

<!--
Mọi thay đổi hành vi đều cần test ở đúng tầng. Xem docs/testing.md.

- [ ] unit        — một đơn vị trong cô lập
- [ ] tích hợp    — vài thành phần thật làm việc cùng nhau
- [ ] hồi quy     — ghim hành vi đã phát hành
- [ ] e2e         — trình duyệt thật, bản build production
- [ ] không cần test (tài liệu, format, cấu hình không ảnh hưởng runtime)
-->

**Một regression test phải fail trước bản sửa.** Nếu bạn sửa một lỗi, hãy nói
rõ test nào tái hiện lỗi đó.

## Danh sách kiểm tra

- [ ] Không có mock data hay record bịa nào trong code chạy thật (placeholder gợi ý thì được)
- [ ] Không file nào vượt trần số dòng (`.py` 400 · `.tsx` 260 · `.ts` 350)
- [ ] Không suppression lint mới (`# type: ignore`, `# noqa`, `biome-ignore`)
- [ ] Vẫn đạt ngưỡng coverage — tôi thêm test chứ không hạ ngưỡng
- [ ] Đã cập nhật tài liệu nếu lệnh, endpoint, biến môi trường hoặc quy tắc đổi
- [ ] Không có bí mật, token hay giá trị `.env` thật trong diff
- [ ] Nội dung hiển thị trên web bằng tiếng Việt; mã nguồn và comment bằng tiếng Anh
- [ ] Tiêu đề theo Conventional Commits: `feat:`, `fix:`, `test:`, `docs:`, …
