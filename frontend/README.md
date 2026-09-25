# AmigoAct web

Frontend Next.js 16 App Router. React 19, TypeScript, Tailwind 4, quản lý bằng
[Bun](https://bun.sh/).

Tài liệu chung của toàn repo nằm ở [`../docs`](../docs); file này chỉ là tra
cứu nhanh riêng cho package frontend.

## Cài đặt

```bash
bun install
cp .env.example .env
```

## Chạy

```bash
bun run dev          # http://localhost:3000
bun run build && bun run start
```

## Bố cục

```
app/           # route App Router — mặc định là server component
components/    # component client và component hiển thị
lib/           # hàm trợ giúp không phụ thuộc framework — không react, không next/*
tests/
├── unit/         # hàm thuần
├── integration/  # component và route được render trong jsdom
├── regression/   # hợp đồng liên stack đã ghim
└── e2e/          # Playwright trên bản build production
```

Giữ cho `lib/` không import `react` hay `next/*`. Đó là điều cho phép unit test
nó. Xem [architecture.md](../docs/architecture.md#quy-tắc-phụ-thuộc).

## Lệnh

| | |
| --- | --- |
| `bun run lint` | biome check (lint + format) |
| `bun run lint:fix` | biome check --write |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run test` | cả ba tầng vitest |
| `bun run test:unit` \| `test:integration` \| `test:regression` | một tầng |
| `bun run test:coverage` | + ngưỡng 80% statement/branch/function/line |
| `bun run e2e:install` | một lần — tải Chromium |
| `bun run e2e` | Playwright, bản build production, cổng 3100 |
| `bun run e2e:ui` | giao diện Playwright, để debug |
| `bun run check` | lint + typecheck + test |

## Test

- Ba project Vitest — `unit`, `integration`, `regression` — mỗi project có môi
  trường và setup riêng. Chạy một project bằng `--project unit`.
- Coverage dùng provider `istanbul`, không phải `v8`, vì nó đo qua source map và
  số thứ tự branch khớp với source thật.
- E2E chạy trên `next build` + `next start`, không phải dev server, nên lỗi phản
  ánh đúng thứ sẽ được deploy.

Chi tiết ở [testing.md](../docs/testing.md).

## Ghi chú

- `biome.json` đặt `vcs.enabled: false`. Repo chỉ có một `.gitignore` ở thư mục
  gốc, còn Biome chỉ tìm trong thư mục làm việc của chính nó. Các thư mục sinh ra
  được liệt kê trong `files.includes` — hãy thêm thư mục mới vào đó.
- `next-env.d.ts` bị git-ignore, theo quy ước của Next.js. Nó được sinh lại bởi
  `next dev` và `next build`.
- App Router mặc định dùng server component. Chỉ thêm `"use client"` khi component
  cần state, effect hoặc event handler.
- Phiên bản Next.js này khác tài liệu đã xuất bản. Hãy đọc
  `node_modules/next/dist/docs/` trước khi viết code chưa quen thuộc — xem
  [hướng dẫn cho agent](../AGENTS.md).

## Ngôn ngữ

Toàn bộ nội dung hiển thị trên web là tiếng Việt: tiêu đề, mô tả, nhãn, placeholder,
và chuỗi lời chào mặc định. `layout.tsx` đặt `<html lang="vi">` và mọi font Google
khai báo `"vietnamese"` trong `subsets` để dấu tiếng Việt hiển thị đúng. Tên biến,
tên hàm và comment chú thích vẫn là tiếng Anh.
