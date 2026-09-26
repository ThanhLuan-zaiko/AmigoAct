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

Dev/start chạy port 3000 (`next` đọc `PORT` nếu đặt); Playwright dùng `PORT`
riêng, mặc định 3100.

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
  <SpeculationRules prerender={["/orgs/new"]} prefetch={["/login"]} />
  ```

  `prerender` render hẳn trang đích trong frame ẩn — dùng tiết kiệm.
- **WebSocket** — `components/realtime-provider.tsx` mở socket chia sẻ ngay
  khi có session (`wsUrl("/api/ws")` + `?token=<jwt>`) và dịch mỗi envelope
  `{type, data}` sang invalidation TanStack Query qua map thuần
  `realtimeInvalidations` (`lib/realtime-events.ts`, bốn loại event cố định
  `activity.changed` / `registration.changed` / `checkin.recorded` /
  `record.changed`). Socket nền là `createSocket()` trong
  `lib/websocket.ts`: reconnect backoff luỹ thừa, close `4401` (token chết)
  → `logout()`. Trạng thái socket đọc qua `useSocketStatus()` (chấm trạng
  thái trên `AppHeader`).

Dữ liệu realtime đi qua socket này — không poll REST. Fetch một-lần vẫn qua
TanStack Query.

Stack provider mount một lần ở root layout (`components/providers.tsx`), theo
thứ tự: `ThemeProvider` (class `dark` trên `<html>` trước paint) →
`QueryClientProvider` (`staleTime` 30s, `retry` 1) → `AuthProvider` (session
+ token `amigoact-token` trong `localStorage`) → `RealtimeProvider` (socket
chỉ mở khi đã đăng nhập) → `AppHeader`.

## Bố cục

```
app/           # route App Router — mặc định là server component
components/    # provider stack, component dùng chung (xem docs/ui-design.md)
lib/           # hàm không framework — không import react hay next/*
tests/
├── unit/         # hàm thuần
├── integration/  # component và route được render trong jsdom
├── regression/   # hợp đồng liên stack đã ghim
└── e2e/          # Playwright trên bản build production
```

Trong `lib/`:

| File | Vai trò |
| --- | --- |
| `api.ts` | `apiFetch` — client fetch duy nhất: gắn bearer token, dịch lỗi `{detail, code}` và validation sang `ApiError` |
| `errors.ts` | Map `code`/detail → message tiếng Việt hiển thị trên UI |
| `config.ts` | `apiUrl()` / `wsUrl()` suy từ `NEXT_PUBLIC_API_URL` |
| `auth-storage.ts` | Đọc/ghi/xoá token `amigoact-token` trong `localStorage` |
| `websocket.ts` | `createSocket()`: envelope, reconnect backoff, mã đóng |
| `realtime-events.ts` | Map event WS → query key cần invalidate |
| `query-keys.ts` | `qk` — nhà máy query key tập trung |
| `types.ts`, `records-types.ts` | Kiểu response API dùng chung |
| `labels.ts` | Nhãn tiếng Việt cho role/status vocab |
| `activity-form.ts`, `checkin.ts` | Parse/validate form hoạt động và mã điểm danh |
| `download.ts` | Tải file (PDF chứng nhận) qua fetch có auth → blob → save |
| `format.ts` | Định dạng ngày/giờ/số theo locale vi |
| `theme.ts` | `Theme` type + `THEME_STORAGE_KEY` |
| `speculation-rules.ts` | Builder JSON cho `<script type="speculationrules">` |
| `health.ts`, `greeting.ts` | Ping backend lúc startup + domain greeting demo |

Giữ cho `lib/` không import `react` hay `next/*`. Đó là điều cho phép unit test
nó. Xem [architecture.md](../docs/architecture.md#quy-tắc-phụ-thuộc).

## Route

Mọi route trừ `/`, `/login`, `/register` đi qua `RequireAuth` — anonymous bị
đẩy về `/login?next=<đường cũ>`. Quyền theo vai trò (manager/admin) do
backend ép; UI chỉ giấu/để lộ điều khiển tương ứng.

| Đường dẫn | Màn hình |
| --- | --- |
| `/` | Landing: hero + thẻ tính năng + link đăng nhập/tạo tài khoản |
| `/login` | Đăng nhập → `POST /auth/login`, hỗ trợ `?next=` |
| `/register` | Đăng ký tài khoản → `POST /auth/register` |
| `/dashboard` | Org của mình + feed hoạt động (`/auth/me`, `/me/feed`) |
| `/orgs/new` | Tạo tổ chức mới |
| `/orgs/join` | Vào org bằng mã code |
| `/orgs/[orgId]` | Trang org: giới thiệu, stats, danh sách hoạt động |
| `/orgs/[orgId]/members` | Quản lý roster (manager+) |
| `/orgs/[orgId]/members/[memberId]/records` | Sổ giờ/điểm của một member + ghi nhận tay (manager+) |
| `/orgs/[orgId]/reports` | Báo cáo tổng quan + phễu đăng ký (manager+) |
| `/orgs/[orgId]/activities/new` | Tạo hoạt động (manager+) |
| `/activities/[id]` | Chi tiết hoạt động + nút đăng ký/huỷ |
| `/activities/[id]/edit` | Sửa hoạt động (manager+) |
| `/activities/[id]/manage` | Bàn điều hành: QR panel, lifecycle, duyệt đăng ký, điểm danh tay (manager+) |
| `/checkin` | Trang đích của QR điểm danh (`?a=<activity>&c=<code>`) + dán mã thủ công; xác nhận luôn cần gesture |
| `/me/registrations` | Đăng ký của mình (`/me/registrations`) |
| `/me/hours` | Sổ giờ của mình (`/me/records`) + tải PDF chứng nhận |

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
