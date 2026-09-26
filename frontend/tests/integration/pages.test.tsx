/**
 * Smoke tests for the Phase 5 route entry points: each `page.tsx` wraps its
 * view in `RequireAuth`, dynamic routes await their `params` promise, and
 * `/checkin` keeps `useSearchParams` under `<Suspense>`. Rendered through
 * the provider stack with mocked `fetch`.
 *
 * Layer: **integration**
 */
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ActivityPage from "@/app/activities/[id]/page";
import CheckinPage from "@/app/checkin/page";
import MyRegistrationsPage from "@/app/me/registrations/page";
import NewActivityPage from "@/app/orgs/[orgId]/activities/new/page";
import OrgPage from "@/app/orgs/[orgId]/page";
import JoinOrgPage from "@/app/orgs/join/page";
import NewOrgPage from "@/app/orgs/new/page";
import { mockApi } from "@/tests/helpers/api-mock";
import { activityDetail, orgDetail } from "@/tests/helpers/fixtures";
import { renderAuthed, testMe } from "@/tests/helpers/render";
import { setMockSearchString } from "@/tests/setup";

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * `AuthProvider` bootstraps `GET /api/auth/me` once `SignInProbe` stores
 * the token — without a handler the session would collapse back to
 * anonymous before `RequireAuth` opens the gate.
 */
function stubMe() {
  return { "GET /api/auth/me": { body: testMe() } } as const;
}

describe("route entry points", () => {
  it("/orgs/new renders the create form", async () => {
    mockApi({ ...stubMe() });
    renderAuthed(<NewOrgPage />);
    expect(
      await screen.findByRole("heading", { name: "Tạo tổ chức" }),
    ).toBeInTheDocument();
  });

  it("/orgs/join renders the join form", async () => {
    mockApi({ ...stubMe() });
    renderAuthed(<JoinOrgPage />);
    expect(
      await screen.findByRole("heading", { name: "Tham gia tổ chức" }),
    ).toBeInTheDocument();
  });

  it("/orgs/[orgId] awaits params and threads orgId", async () => {
    mockApi({
      ...stubMe(),
      "GET /api/orgs/o-1": { body: orgDetail() },
      "GET /api/orgs/o-1/activities": { body: { activities: [] } },
    });
    const element = await OrgPage({
      params: Promise.resolve({ orgId: "o-1" }),
    });
    renderAuthed(element);
    expect(
      await screen.findByRole("heading", { name: "CLB Tình nguyện" }),
    ).toBeInTheDocument();
  });

  it("/orgs/[orgId]/activities/new renders behind the manager gate", async () => {
    mockApi({
      ...stubMe(),
      "GET /api/orgs/o-1": { body: orgDetail("manager") },
    });
    const element = await NewActivityPage({
      params: Promise.resolve({ orgId: "o-1" }),
    });
    renderAuthed(element);
    expect(
      await screen.findByRole("heading", { name: "Tạo hoạt động" }),
    ).toBeInTheDocument();
  });

  it("/activities/[id] awaits params and threads the id", async () => {
    mockApi({
      ...stubMe(),
      "GET /api/activities/a-1": { body: activityDetail() },
      "GET /api/orgs/o-1": { body: orgDetail() },
    });
    const element = await ActivityPage({
      params: Promise.resolve({ id: "a-1" }),
    });
    renderAuthed(element);
    expect(
      await screen.findByRole("heading", { name: "Hiến máu tình nguyện" }),
    ).toBeInTheDocument();
  });

  it("/checkin renders inside Suspense", async () => {
    setMockSearchString("");
    mockApi({
      ...stubMe(),
      "GET /api/me/registrations": { body: { registrations: [] } },
    });
    renderAuthed(<CheckinPage />);
    expect(
      await screen.findByRole("heading", { name: "Điểm danh" }),
    ).toBeInTheDocument();
  });

  it("/me/registrations renders the grouped list", async () => {
    mockApi({
      ...stubMe(),
      "GET /api/me/registrations": { body: { registrations: [] } },
    });
    renderAuthed(<MyRegistrationsPage />);
    expect(
      await screen.findByRole("heading", { name: "Đăng ký của tôi" }),
    ).toBeInTheDocument();
  });
});
