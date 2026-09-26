# AmigoAct web

Frontend Next.js 16 App Router. React 19, TypeScript, Tailwind 4, quản lý bằng
[Bun](https://bun.sh/).

Tài liệu chung của toàn repo nằm ở [`../docs`](../docs); file này chỉ là tra
cứu nhanh riêng cho package frontend.

## Cài đặt

```bash
bun install
cp .env.example .env.local
```

`.env.local` override `.env` khi `next dev` và được git-ignore.
`NEXT_PUBLIC_API_URL` trỏ tới backend FastAPI (mặc định
`http://localhost:8100` — port 8000 bị WSL port relay chiếm bởi Portainer).

## Chạy

```bash
bun run dev          # http://localhost:3000
bun run build && bun run start
```

Khi server khởi động, `instrumentation.ts` ping `GET /api/health` của backend
và **chỉ log** kết quả ra console — không hiển thị trên UI:

```
[api] backend reachable: http://localhost:8100/api/health (AmigoAct API v0.1.0, development)
[api] backend unreachable: http://localhost:8100/api/health - fetch failed: connect ECONNREFUSED ...
```

## Xương sống: Speculation Rules + WebSocket

Điều hướng tức thì và trạng thái realtime là nền của app — hai khung tái sử
dụng sau đây là điểm vào duy nhất:

- **Speculation Rules API** — `components/speculation-rules.tsx` render
  `<script type="speculationrules">`; builder thuần ở `lib/speculation-rules.ts`.
  Gắn vào page khi biết route kế tiếp người dùng hay tới:

  ```tsx
  <SpeculationRules prerender={["/activities/new"]} prefetch={["/login"]} />
  ```

  `prerender` render hẳn trang đích trong frame ẩn — dùng tiết kiệm.
- **WebSocket** — `lib/websocket.ts` `createSocket()` nối tới
  `wsUrl("/api/ws")` (suy ra từ `NEXT_PUBLIC_API_URL`), envelope
  `{type, data}`, handler theo type, tự reconnect backoff luỹ thừa, và gắn
  JWT qua `?token=` khi backend bật auth:

  ```ts
  const socket = createSocket({ url: wsUrl("/api/ws"), token });
  socket.on("announce", (data) => { /* ... */ });
  ```

Dữ liệu realtime đi qua socket này — không poll REST. Fetch một-lần vẫn qua
TanStack Query.

## Bố cục

```
app/           # route App Router — mặc định là server component
components/    # component client/hiển thị + <SpeculationRules>
lib/           # hàm không framework — config, health, ws client, speculation builder
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
