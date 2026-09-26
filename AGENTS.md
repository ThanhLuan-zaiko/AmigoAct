<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

---

# AmigoAct — Agent Guide

Fullstack monorepo: a **FastAPI** service (`backend/`) and a **Next.js 16 App Router** frontend (`frontend/`).

| Concern | Backend | Frontend |
| --- | --- | --- |
| Language / runtime | Python 3.14 | TypeScript 5, React 19 |
| Package manager | `uv` | `bun` |
| Lint + format | `ruff` | `biome` |
| Types | `mypy --strict` | `tsc --noEmit` |
| Tests | `pytest` | `vitest` (unit/integration/regression) + `playwright` (e2e) |
| Local port | 8100 (8000 is taken by the WSL Portainer relay) | 3000 |

## Language convention

This is a Vietnamese-language product. The rule is mechanical so it never needs
judgement:

| Surface | Language |
| --- | --- |
| **Everything a user reads in the app** — UI copy, labels, placeholders, `<title>`, `description`, empty states, validation messages shown on screen, default data returned by the API and rendered | **Vietnamese** |
| **All `.md` files** — README, CONTRIBUTING, `docs/`, PR and issue templates | **Vietnamese** |
| **`AGENTS.md`** | **English** (the one exception) |
| Code, identifiers, file names, type and function names, test names | **English** |
| Code comments and docstrings (`#`, `/** */`, `"""`) | **English** |
| Commit messages, PR titles, branch names, GitHub Actions step names | **English** |
| Commit and CI log output, linter and compiler diagnostics | **English** (tooling-generated, not ours to translate) |
| `CODEOWNERS`, `dependabot.yml`, `labeler.yml`, config file values | **English** |

Practical notes:

- Set `<html lang="vi">` in `frontend/app/layout.tsx` and add `"vietnamese"` to
  any Google font `subsets`, otherwise Vietnamese diacritics render as tofu.
- Shared constants that carry user-facing text — `DEFAULT_GREETING`,
  `DEFAULT_NAME` in `backend/src/backend/domain/greeting.py` and
  `frontend/lib/greeting.ts` — are pinned by regression tests on **both** sides.
  Change one, change the other, change both tests in the same commit.
- API **error messages** (`InvalidNameError` and friends) stay English: they are
  developer diagnostics, not screen copy. If a message is ever rendered to an
  end user, translate it at the render site, not in the exception.
- Do not translate a symbol, a command, a file path, a config key, or a code
  sample — only prose.

## Repository layout

```
.
├── .github/            # CI, templates, automation
├── backend/
│   ├── src/backend/    # domain/ (pure) · api/ (HTTP) · main.py · config.py
│   └── tests/          # unit/ · integration/ · regression/
├── frontend/
│   ├── app/            # App Router routes
│   ├── components/     # client + presentational components
│   ├── lib/            # framework-free helpers
│   └── tests/          # unit/ · integration/ · regression/ · e2e/
├── docs/               # human-facing documentation
└── scripts/            # check-file-size.mjs + file-limits.config.json
```

Layering rule that matters: **`backend/src/backend/domain/` and `frontend/lib/` must stay framework-free.** No `fastapi`, no `next/*`, no React imports. That is what makes them cheap to unit test.

## Commands

Run every command from the package it belongs to.

```bash
# Backend — cd backend
uv sync --all-groups                            # install
uv run uvicorn backend.main:app --reload --port 8100  # dev server on :8100
uv run ruff check . && uv run ruff format .    # lint + format
uv run ruff check --fix .                      # autofix
uv run mypy                                    # strict type check
uv run pytest                                  # all layers + coverage
uv run pytest -m unit                          # one layer only
uv run pytest -m integration
uv run pytest -m regression
uv run pytest --lf                             # re-run last failures

# Frontend — cd frontend
bun install                                    # install
bun run dev                                    # dev server on :3000
bun run build && bun run start                 # production build
bun run lint                                   # biome check
bun run lint:fix                               # biome check --write
bun run typecheck                              # tsc --noEmit
bun run test                                   # vitest, all three layers
bun run test:unit | test:integration | test:regression
bun run test:coverage                          # + 80% thresholds
bun run e2e:install                            # one-time: download Chromium
bun run e2e                                    # Playwright end-to-end
bun run check                                  # lint + typecheck + test

# Repo root
bun run scripts/check-file-size.mjs            # enforce the line ceilings
bun run scripts/check-file-size.mjs --staged   # only staged files (pre-commit)
```

## File size limits

**These are hard limits. A file that reaches its ceiling must be split, not grown.**

| Extension | Ceiling | Rationale |
| --- | --- | --- |
| `.py` | **400 lines** | Python needs more boilerplate per idea than TS. |
| `.tsx` | **260 lines** | JSX inflates line count; the tightest ceiling in the repo. |
| `.ts` | **350 lines** | Dense, mostly declarative code. |

Enforced by `scripts/check-file-size.mjs` (limits in `scripts/file-limits.config.json`) and by the `file-size` CI job. The script prints each file's utilisation and fails at 100%.

### How to split

When a file crosses a ceiling, split along a **seam**, never by cutting a class or function in half:

1. **Extract domain logic** into `domain/` or `lib/` — pure, no framework.
2. **Extract one cohesive unit** into its own module with a single reason to change
   (Open/Closed). One file, one job.
3. **Extract types** into a `types.ts` / `schemas.py` co-located with its user.
4. **Split by concern**: routes / validation / orchestration / presentation.
5. **Split test files** the same way — one `test_<unit>.py` per unit.

Every split ships **with** the tests for the extracted code. A refactor that leaves new code uncovered fails the coverage gate.

Emergency escape hatch: add an entry to `exemptions` in `scripts/file-limits.config.json` **with a reason and an owner**, as a separate, reviewable commit. Do not weaken the number itself.

## Testing policy

Full detail in [`docs/testing.md`](docs/testing.md). The rules:

1. **Test-first.** Write the failing test before the implementation whenever the
   behaviour is specified. A bug fix always starts with a test that reproduces
   the bug — a regression test — and that test is the proof the fix worked.
2. **Three layers, three purposes.** Do not mix them.

   | Layer | Markers | Scope | Speed | Runs in |
   | --- | --- | --- | --- | --- |
   | Unit | `unit` | One unit in isolation. No I/O, no network, no app. | < 50 ms | every commit |
   | Integration | `integration` | Several real components together — HTTP, fs, db. | < 2 s | every commit |
   | Regression | `regression` | Locks in behaviour that already shipped. Exact shapes, not truthiness. | < 2 s | every commit |
   | End-to-end | Playwright | Real browser against a production build. | minutes | CI + pre-release |

3. **Every behaviour change needs a test in the right layer.** New endpoint →
   `integration`. New pure function → `unit`. Anything that changed behaviour of
   something already shipped → `regression`.
4. **Coverage floors are gates, not goals.** Backend `pytest` fails below 80%
   (`--cov-fail-under=80`); the frontend `vitest` thresholds are 80% across
   statements/branches/functions/lines. Do not lower them to make a PR pass —
   add the missing test.
5. **No test reaches the public network.** Mock `fetch`, use `TestClient`,
   `tmp_path`, or a fixture. Only the Playwright suite talks to a real server.
6. **Assert behaviour, not implementation.** Prefer accessible queries
   (`getByRole`, `getByLabelText`) over test ids or CSS selectors on the
   frontend; prefer response bodies over internal function calls on the backend.
7. **A failing regression test is never "updated to pass" without a reason.**
   If a contract genuinely changed, say so in the PR description and update the
   regression test, the docs, and any consumer in the same commit.

### Test placement

| | Backend | Frontend |
| --- | --- | --- |
| Unit | `backend/tests/unit/` | `frontend/tests/unit/` |
| Integration | `backend/tests/integration/` | `frontend/tests/integration/` |
| Regression | `backend/tests/regression/` | `frontend/tests/regression/` |
| End-to-end | — | `frontend/tests/e2e/` |

## No mock data

**Absolute rule: no mock, fake, sample, or hardcoded record may exist in any code path that runs outside the test suite.** A user must never reach a screen showing data that did not come from the real system of record. There is no such thing as "temporary" mock data — it ships, it gets screenshotted, and it outlives the task that added it. Guidance placeholders are a separate, allowed thing; see the line below.

### The line

> A placeholder that tells the user **what to do** is allowed. A placeholder that pretends to **be the data** is not.

### Banned

- Hardcoded arrays or objects of records returned or rendered in place of real data.
- Invented metrics, counts, charts, activity feeds, testimonials, reviews, ratings, uptime figures, or user numbers.
- A route handler that serves `[{ id: 1, name: "Alice" }, …]` so the UI looks finished.
- Stubbed/intercepted responses, service-worker fixtures, or a `fetch` override enabled outside tests.
- `Math.random()`, `Date.now()`, or hardcoded IDs standing in for real records.
- Demo or seed accounts, "guest" logins, and `.env` values shaped like real credentials.
- Copy that states facts nobody verified — pricing, limits, guarantees, legal claims.
- Content that impersonates real data rather than guiding the user: "Lorem ipsum", a permanent "Coming soon" shipped as if it were the finished feature, placeholder avatars or artwork presented as real content.
- Error states that lie: swallowing a failed request and substituting an empty or invented result so the page "looks fine", or letting `null` / `undefined` / `[]` / `NaN` reach the screen.

### Allowed

- **The test suite**, in full: fixtures, factories, `vi.mock`, `TestClient` payloads, seeded in-memory data, `msw` handlers. Mocking here is not a compromise — it is the job.
- **Guidance placeholders and helper copy.** `placeholder="Nhập tên"`, hint text under a field, a tooltip, a format example (`"vd: 0909 123 456"`), validation guidance, an explanation on a disabled button. These speak *to* the user about what to do next and never stand in for the data itself.
- **Empty-state copy that guides.** "Chưa có hoạt động nào — hãy tạo hoạt động đầu tiên." It tells the user what happened and what to do, and it stays true when the collection is genuinely empty.
- **Honest UI states for real conditions:** skeleton, spinner, empty state, error state. These represent something true about the system, not invented records.
- **Types, interfaces, and OpenAPI schemas** describing a response that is not implemented yet. A type is not data.
- **Isolated dev harnesses** (Storybook, a dev-only route) excluded from the production build and unreachable in a deployed environment.
- **Seed data for a local, disposable database**, loaded only by an explicit dev command such as `uv run backend.seed`. It must never be read by the app at runtime, and the command must refuse to run against a non-local database URL.

### Do this instead

1. Build the real path first — the route, the query, the client, the loading and error states.
2. If the backend is not ready, return the honest result: an empty collection plus a real empty-state UI, or a typed error surfaced to the user. Never invent a record to fill the gap.
3. Types first. Define the response shape, let both sides compile against it, then fill in the real query.
4. Call out the not-ready state in the PR description. A reviewer decides whether to accept an honest gap; they cannot accept a lie they do not know about.

### Enforcement

- Reviewers reject any diff that introduces a literal collection of records into `app/`, `components/`, `lib/`, `backend/src/`.
- A PR that legitimately needs fixtures in a production path must justify it in the description, and the fixtures must be unreachable in a deployed build.
- Regression tests assert shapes from the real system, so fabricated data drifts out of sync and fails.

> The `/api/greeting` endpoint in this repo is **not** mock data: it is a real endpoint that computes a real response from its input and stores nothing. Nothing in it pretends to be a user, a record, or a fact.

## Code style

- **Backend** — `ruff` owns lint and format (`line-length = 100`, Google
  docstrings). `mypy --strict` must stay clean; every function is annotated.
  Depend on abstractions: `backend.domain` imports nothing from `backend.api`.
- **Frontend** — `biome` owns lint and format (80 columns, double quotes, ESM
  imports). Prefer server components; add `"use client"` only when a component
  needs state, effects, or event handlers. **Styling is Tailwind utility
  classes only** — no hand-written CSS rules or extra `.css` files; the single
  exception is `app/globals.css`, which exists solely to import Tailwind.
  **Client-side API fetching goes through TanStack Query** (`useQuery` /
  `useMutation`, provider wired in `components/providers.tsx`) — never fetch
  inside a bare `useEffect`. Server-rendered reads stay in Server Components.
- **Both** — fail loudly. Raise an explicit exception with a message; never
  swallow an error to make a test pass.

## Git workflow

- After finishing a code change, review it with `git status` and `git diff`
  before declaring it done.
- Commits follow Conventional Commits and are **local only** — never run
  `git push` unless the user explicitly asks for it.

## Definition of done

A change is done when all of these pass locally:

```bash
cd backend  && uv run ruff check . && uv run mypy && uv run pytest
cd frontend && bun run check
bun run scripts/check-file-size.mjs
```

plus, for UI changes, `cd frontend && bun run e2e`.

- [ ] The behaviour is covered by a test at the correct layer
- [ ] A bug fix includes a regression test that failed before the fix
- [ ] **No mock data, placeholder, or invented record outside the test suite**
- [ ] No file exceeds its line ceiling
- [ ] `ruff`, `mypy`, `biome`, and `tsc` are clean — no new suppressions
- [ ] Coverage floors still met
- [ ] Docs updated if a command, endpoint, or rule changed
- [ ] Commit messages follow Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`, `ci:`)

## Documentation

- [`docs/development.md`](docs/development.md) — local setup and day-to-day commands
- [`docs/architecture.md`](docs/architecture.md) — how the pieces fit together
- [`docs/testing.md`](docs/testing.md) — the three test layers in depth
- [`docs/ci.md`](docs/ci.md) — what every CI job does and how to debug it
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — branch naming, PR process, review rules
