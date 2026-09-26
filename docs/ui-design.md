# Thiết kế giao diện

Tài liệu này là luật bắt buộc cho mọi màn hình của AmigoAct.
`AGENTS.md` chỉ dẫn tới đây để giữ gọn; mọi code giao diện phải tuân thủ đầy đủ các mục dưới.

## Nguyên tắc bắt buộc

1. **Hai theme light/dark đầy đủ.** Mọi màn hình phải đọc được ở cả hai theme. Không hardcode màu một theme, không để chữ chìm vào nền ở theme còn lại.
2. **Đồng bộ với hệ điều hành.** Mặc định theme khởi tạo theo `prefers-color-scheme` của hệ điều hành: hệ điều hành dark thì webapp dark, hệ điều hành light thì webapp light.
3. **Nút chuyển theme thủ công.** Luôn có nút chuyển theme trên giao diện. Lựa chọn thủ công được ưu tiên hơn hệ điều hành và được lưu lại (`localStorage`) cho lần sau.
4. **Cấm `box-shadow` để làm nổi bật panel.** Panel/card phân tách bằng `border` + tương phản `background`, không dùng `box-shadow`, không dùng `drop-shadow` cho mục đích này.
5. **Trang trí icon chỉ dùng `react-icons`.** Không dùng emoji, không dùng SVG rời rạc, không dùng thư viện icon khác. Mọi icon trang trí đều import từ `react-icons`.

## Cách làm chuẩn

### Theme (Tailwind v4 + Next.js)

- Trong `frontend/app/globals.css`, khai báo dark mode theo class để nút bấm thủ công hoạt động được:

```css
@import "tailwindcss";
@custom-variant dark (&:where(.dark, .dark *));
```

- Viết style theo cặp, ví dụ `bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100`, `border-neutral-200 dark:border-neutral-800`.
- `ThemeProvider` là client component duy nhất giữ state theme:
  - Khởi tạo: đọc `localStorage` trước, nếu chưa có thì đọc `matchMedia("(prefers-color-scheme: dark)")`.
  - Gắn/gỡ class `dark` trên `<html>`, lắng nghe đổi `prefers-color-scheme` khi người dùng chưa chọn thủ công.
  - Thêm `suppressHydrationWarning` trên `<html>` trong `app/layout.tsx` để tránh lệch SSR/lần render đầu.
- `ThemeToggle` là nút có `aria-label` tiếng Việt (ví dụ `"Chuyển sang giao diện tối"`), icon mặt trời/mặt trăng từ `react-icons`, đặt ở vị trí cố định (thường là header).

### Panel không dùng shadow

- Panel chuẩn: `rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900`.
- Phân cấp bằng: viền đậm hơn, nền chìm/nổi (`bg-neutral-50 dark:bg-neutral-950`), khoảng cách và typography — không thêm `shadow-*`.
- Cấm toàn repo: `shadow-*`, `drop-shadow*`, `box-shadow` viết tay trong `style` hay CSS. Lệnh review: tìm `shadow` trong `frontend/app`, `frontend/components` phải trả về 0 kết quả ngoài test.

### Icon với `react-icons`

- Cài một lần: `cd frontend && bun add react-icons`.
- Import theo nhóm icon cụ thể, ví dụ `import { FiSun, FiMoon } from "react-icons/fi"`.
- Icon trang trí luôn có `aria-hidden="true"`; nút chứa icon phải có `aria-label` tiếng Việt. Không dùng emoji thay icon.

## Checklist cho mỗi PR giao diện

- [ ] Chụp hoặc kiểm thử cả light và dark, cả khi hệ điều hành đổi theme.
- [ ] Nút chuyển theme hiển thị, bấm đổi ngay, reload vẫn giữ lựa chọn.
- [ ] Không có `shadow` trong code panel mới.
- [ ] Mọi icon từ `react-icons`, không có emoji trong UI.
- [ ] Chữ tiếng Việt đầy đủ dấu ở cả hai theme, tương phản đọc được.
- [ ] Test đúng tầng: logic theme thuần vào `tests/unit`, render + bấm nút vào `tests/integration`, chốt hợp đồng class/hành vi đã ship vào `tests/regression`.

## Thứ tự ưu tiên khi xung đột

Theme theo hệ điều hành < lựa chọn thủ công của người dùng. Quy tắc cấm `box-shadow` và bắt buộc `react-icons` không có ngoại lệ — có xung đột với thẩm mỹ thì đổi thẩm mỹ, không đổi luật.
