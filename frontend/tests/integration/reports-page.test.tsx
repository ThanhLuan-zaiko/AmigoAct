/**
 * Integration tests for `/orgs/[orgId]/reports` (ReportsView +
 * reports-tables): the stat cards reflect the mocked totals, the date
 * range inputs re-query with `from`/`to` params, tables render honestly,
 * and empty ranges show the empty note. `fetch` routed through `mockApi`.
 *
 * Layer: **integration**
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReportsView } from "@/app/orgs/[orgId]/reports/reports-view";
import type { MemberRole, ReportsOverview } from "@/lib/types";
import { callsTo, mockApi } from "@/tests/helpers/api-mock";
import {
  activityReportRow,
  orgDetail,
  reportsOverview,
} from "@/tests/helpers/fixtures";
import { renderAuthed } from "@/tests/helpers/render";
import {
  getMockRouter,
  setMockPathname,
  setMockSearchString,
} from "@/tests/setup";

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockReports(
  role: MemberRole = "manager",
  overview: ReportsOverview = reportsOverview(),
) {
  return mockApi({
    "GET /api/orgs/o-1": { body: orgDetail(role) },
    "GET /api/orgs/o-1/reports/overview": { body: overview },
    "GET /api/orgs/o-1/reports/activities": {
      body: { activities: [activityReportRow()] },
    },
  });
}

describe("ReportsView", () => {
  it("renders the overview cards with the mocked totals", async () => {
    mockReports();
    renderAuthed(<ReportsView orgId="o-1" />);

    expect(
      await screen.findByRole("heading", { name: "Báo cáo" }),
    ).toBeInTheDocument();
    // "Hoạt động" is also a table header — the label appears ≥2 times.
    expect(screen.getAllByText("Hoạt động").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("6")).toBeInTheDocument();
    // Stat card label + the activity status chip.
    expect(screen.getAllByText("Đã hoàn thành").length).toBeGreaterThanOrEqual(
      2,
    );
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Lượt đăng ký")).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument();
    expect(screen.getByText("Điểm danh")).toBeInTheDocument();
    expect(screen.getByText("24")).toBeInTheDocument();
    // 0.8 → vi-VN percent "80%".
    expect(screen.getByText("Tỷ lệ điểm danh")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText("48")).toBeInTheDocument();
  });

  it("renders monthly, faculty, top-volunteer and activity sections", async () => {
    mockReports();
    renderAuthed(<ReportsView orgId="o-1" />);

    expect(await screen.findByText("05/2026")).toBeInTheDocument();
    expect(screen.getByText("06/2026")).toBeInTheDocument();
    // Faculty null renders as "—", the named faculty is visible.
    expect(screen.getByText("Công nghệ thông tin")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
    // Top volunteers ordered list + the per-activity row.
    expect(screen.getByText("Top tình nguyện viên")).toBeInTheDocument();
    expect(screen.getByText(/5 thành tích/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Hiến máu tình nguyện" }),
    ).toHaveAttribute("href", "/activities/a-1");
    // Stat card + activity status chip both carry the label.
    expect(screen.getAllByText("Đã hoàn thành").length).toBeGreaterThanOrEqual(
      2,
    );
    // ĐK / Duyệt / ĐD column.
    expect(screen.getByText("45 / 40 / 32")).toBeInTheDocument();
  });

  it("re-queries with from/to params and syncs the URL", async () => {
    setMockPathname("/orgs/o-1/reports");
    const calls = mockReports();
    renderAuthed(<ReportsView orgId="o-1" />);

    await screen.findByRole("heading", { name: "Báo cáo" });
    // The first fetches carry no params.
    const first = callsTo(calls, "GET", "/api/orgs/o-1/reports/overview");
    expect(first).toHaveLength(1);
    expect(first[0].query.get("from")).toBeNull();

    fireEvent.change(screen.getByLabelText("Từ ngày"), {
      target: { value: "2026-01-01" },
    });
    // The key change re-fetches; the view goes through "Đang tải" again.
    await waitFor(() => {
      const ranged = callsTo(
        calls,
        "GET",
        "/api/orgs/o-1/reports/overview",
      ).filter((call) => call.query.get("from") === "2026-01-01");
      expect(ranged.length).toBeGreaterThanOrEqual(1);
    });
    fireEvent.change(await screen.findByLabelText("Đến ngày"), {
      target: { value: "2026-06-30" },
    });
    await waitFor(() => {
      const ranged = callsTo(
        calls,
        "GET",
        "/api/orgs/o-1/reports/overview",
      ).filter(
        (call) =>
          call.query.get("from") === "2026-01-01" &&
          call.query.get("to") === "2026-06-30",
      );
      expect(ranged.length).toBeGreaterThanOrEqual(1);
    });
    // The activities report picks up the same range.
    await waitFor(() => {
      const ranged = callsTo(
        calls,
        "GET",
        "/api/orgs/o-1/reports/activities",
      ).filter((call) => call.query.get("from") === "2026-01-01");
      expect(ranged.length).toBeGreaterThanOrEqual(1);
    });
    // …and the address bar carries the shareable range.
    expect(getMockRouter().replace).toHaveBeenLastCalledWith(
      "/orgs/o-1/reports?from=2026-01-01&to=2026-06-30",
      { scroll: false },
    );
  });

  it("seeds the range from the ?from=&to= query string", async () => {
    setMockPathname("/orgs/o-1/reports");
    setMockSearchString("?from=2026-03-01&to=2026-03-31");
    const calls = mockReports();
    renderAuthed(<ReportsView orgId="o-1" />);

    expect(await screen.findByLabelText("Từ ngày")).toHaveValue("2026-03-01");
    expect(screen.getByLabelText("Đến ngày")).toHaveValue("2026-03-31");
    await waitFor(() => {
      const first = callsTo(
        calls,
        "GET",
        "/api/orgs/o-1/reports/overview",
      ).filter(
        (call) =>
          call.query.get("from") === "2026-03-01" &&
          call.query.get("to") === "2026-03-31",
      );
      expect(first).toHaveLength(1);
    });
  });

  it("shows the empty-range note instead of empty tables", async () => {
    mockApi({
      "GET /api/orgs/o-1": { body: orgDetail("manager") },
      "GET /api/orgs/o-1/reports/overview": {
        body: reportsOverview({
          monthly: [],
          by_faculty: [],
          top_volunteers: [],
        }),
      },
      "GET /api/orgs/o-1/reports/activities": { body: { activities: [] } },
    });
    renderAuthed(<ReportsView orgId="o-1" />);

    await screen.findByRole("heading", { name: "Báo cáo" });
    await waitFor(() => {
      expect(
        screen.getAllByText("Chưa có dữ liệu trong khoảng này").length,
      ).toBeGreaterThanOrEqual(3);
    });
    // Totals still render as honest zeros/numbers, never hidden.
    expect(screen.getByText("Tổng giờ")).toBeInTheDocument();
  });

  it("locks non-managers out without calling the report endpoints", async () => {
    const calls = mockReports("member");
    renderAuthed(<ReportsView orgId="o-1" />);

    expect(await screen.findByText("Cần quyền quản lý")).toBeInTheDocument();
    expect(
      callsTo(calls, "GET", "/api/orgs/o-1/reports/overview"),
    ).toHaveLength(0);
  });
});
