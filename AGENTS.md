<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

---

# AmigoAct — Agent Guide

Fullstack monorepo: **FastAPI** (`backend/`) + **Next.js 16 App Router** (`frontend/`).

| Concern | Backend | Frontend |
| --- | --- | --- |
| Language / runtime | Python 3.14 | TypeScript 5, React 19 |
| Package manager | `uv` | `bun` |
| Lint + format | `ruff` | `biome` |
| Types | `mypy --strict` | `tsc --noEmit` |
| Tests | `pytest` | `vitest` + `playwright` (e2e) |
| Local port | 8100 (8000 is taken by WSL Portainer relay) | 3000 |

## Language convention

Vietnamese-language product. Mechanical rule, no judgement:

- User-facing text (UI copy, `<title>`, empty states, validation shown on screen, API defaults rendered) and all `.md` files (except this one): **Vietnamese**.
- `AGENTS.md`, code, comments, docstrings, commits, PR titles, branches, CI step names, config values, API error messages (`InvalidNameError` et al.): **English**. Translate at render site, never in the exception or symbol.
- Practical: `<html lang="vi">` + `"vietnamese"` font subset; sync `DEFAULT_GREETING` / `DEFAULT_NAME` in `backend/src/backend/domain/greeting.py` and `frontend/lib/greeting.ts` plus both regression tests in one commit.

## Repository layout

```
backend/src/backend/  # domain/ (pure) · api/ (HTTP) · security.py · database.py · websocket.py · main.py · config.py
backend/tests/        # unit/ · integration/ · regression/
frontend/app/         # App Router routes
frontend/components/  # incl. <SpeculationRules>
frontend/lib/         # framework-free helpers
frontend/tests/       # unit/ · integration/ · regression/ · e2e/
docs/ scripts/
```

`backend/src/backend/domain/` and `frontend/lib/` stay framework-free (no `fastapi`, `next/*`, React). `backend.domain` never imports from `backend.api`.

## Architecture backbone

Speculation Rules + WebSocket are the spine. No new fetch/poll paths for live state.

- Speculation Rules: `components/speculation-rules.tsx` + pure builder in `lib/speculation-rules.ts`. `prefetch` liberally, `prerender` sparingly, keep `<Link>` viewport prefetch on.
- WebSocket: single channel `ws(s)://<api>/api/ws`, envelope `{"type": "<name>", "data": {...}}` both ways. Backend owns `ConnectionManager` (`app.state.ws_manager`) and `hello`/`ping`/`error`; extend `_dispatch` for new types, never a second endpoint. Frontend uses `lib/websocket.ts` `createSocket()` + `wsUrl("/api/ws")` with backoff reconnect. Token via `?token=` (browsers cannot set headers).
- Data/auth (backend-owned): UUIDv7 via `domain.ids.new_id`, stored as `RAW(16)` (`uuid.bytes`); passwords argon2id (`security.hash_password`/`verify_password`, never plaintext in DB/logs); JWT bearer only (`create_access_token`/`decode_access_token`, `AMIGOACT_JWT_SECRET` env-only, no default). Frontend attaches tokens, never verifies.

## Commands

Run from its own package. Full detail in `docs/development.md` / `docs/testing.md`.

```bash
# Backend — cd backend
uv sync --all-groups
uv run uvicorn backend.main:app --reload --port 8100
uv run ruff check . && uv run ruff format . && uv run mypy && uv run pytest

# Frontend — cd frontend
bun install
bun run dev
bun run check    # biome + tsc + vitest
bun run e2e      # production build + Playwright (after e2e:install)

# Repo root
bun run scripts/check-file-size.mjs
```

## File size limits

Hard ceilings. Split, never grow past them. Enforced by `scripts/check-file-size.mjs` + `file-size` CI job.

| Ext | Ceiling |
| --- | --- |
| `.py` | 400 lines |
| `.tsx` | 260 lines |
| `.ts` | 350 lines |

Split along seams (extract domain/`lib` logic, one cohesive unit, types, or by concern) with tests for extracted code. Exemption only via `exemptions` in `scripts/file-limits.config.json` with reason + owner, separate commit.

## Testing policy

Detail in `docs/testing.md`.

- Test-first; every bug fix ships a failing-then-passing regression test in the same commit.
- Layers: `unit` (one unit, no I/O, <50ms) · `integration` (real components: HTTP/fs/db, <2s) · `regression` (exact shipped shapes, <2s) · e2e (Playwright, real browser + production build). Placement mirrors layer: `backend/tests/<layer>/`, `frontend/tests/<layer>/` (`e2e/` for Playwright).
- Coverage gates: 80% backend (`--cov-fail-under=80`) and frontend (statements/branches/functions/lines). Never lower to pass.
- No test hits public network (mock `fetch`, `TestClient`, `tmp_path`). Assert behaviour (roles/labels, status + body), not implementation. A red regression test means broken code or an intentional contract change documented in the PR with test + docs + consumers updated together.

## No mock data

No mock/fake/sample/hardcoded record in any non-test runtime path. Guiding copy is allowed; fake data is not.

- Allowed: `placeholder="Nhập tên"`, hints, honest skeleton/spinner/empty/error states, types/schemas, test fixtures, isolated dev harnesses excluded from prod, explicit local-only seed commands.
- Banned: hardcoded record lists, invented metrics/feeds, stubbed responses outside tests, `Math.random()`/`Date.now()` as records, demo accounts, unverified claims, `Lorem ipsum`, lying error states, `null`/`[]`/`NaN` reaching the screen.
- `/api/greeting` is not mock data: real endpoint computing a real response.

## Code style

- Backend: `ruff` (`line-length = 100`, Google docstrings); every function annotated; fail loudly, never swallow errors.
- Frontend: `biome` (80 cols, double quotes, ESM); server components by default, `"use client"` only for state/effects/events; Tailwind utilities only (except `app/globals.css`); client fetch only via TanStack Query (`useQuery`/`useMutation`), never bare `useEffect` fetch. UI must follow `docs/ui-design.md` (OS-synced light/dark + manual toggle, no `box-shadow` panels, `react-icons` only).
- Both: raise explicit errors; no new linter/type suppressions.

## Git workflow

- Review with `git status` + `git diff` before done. Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`, `ci:`). Local commits only — never `git push` unless asked.

## Definition of done

```bash
cd backend && uv run ruff check . && uv run mypy && uv run pytest
cd frontend && bun run check
bun run scripts/check-file-size.mjs
# + bun run e2e for UI changes
```

- [ ] Tested at the right layer (incl. regression for fixes); no mock data outside tests; no ceiling exceeded; `ruff`/`mypy`/`biome`/`tsc` clean; coverage met; docs updated if commands/endpoints/rules changed.

## Documentation

`docs/development.md` · `docs/architecture.md` · `docs/testing.md` · `docs/ci.md` · `docs/ui-design.md` · `CONTRIBUTING.md`
