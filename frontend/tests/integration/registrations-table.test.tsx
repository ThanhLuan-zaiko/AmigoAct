/**
 * Integration tests for the manager `RegistrationsTable`: filter tabs
 * refetch with `?status=`, per-row review actions, manual check-in and
 * the honest empty state. `fetch` mocked.
 *
 * Layer: **integration**
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RegistrationsTable } from "@/components/registrations-table";
import type { RegistrationRow } from "@/lib/types";
import { callsTo, type MockCall, mockApi } from "@/tests/helpers/api-mock";
import { regRow } from "@/tests/helpers/fixtures";
import { renderAuthed } from "@/tests/helpers/render";

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockRegs(rows: RegistrationRow[]): MockCall[] {
  return mockApi({
    "GET /api/activities/a-1/registrations": {
      body: { registrations: rows },
    },
    "POST /api/registrations/r-1/review": { body: { registration: {} } },
    "POST /api/registrations/r-1/checkin": {
      body: {
        registration: { id: "r-1" },
        already_checked_in: false,
        checked_in_count: 1,
      },
    },
  });
}

describe("RegistrationsTable", () => {
  it("renders member info, note and status per row", async () => {
    mockRegs([regRow("pending")]);
    renderAuthed(<RegistrationsTable activityId="a-1" />);

    expect(await screen.findByText("Trần Minh")).toBeInTheDocument();
    expect(screen.getByText(/SV01/)).toBeInTheDocument();
    // "Chờ duyệt" appears twice: the filter tab and the row's status chip.
    expect(screen.getAllByText("Chờ duyệt").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows the checked-in time when present", async () => {
    mockRegs([
      regRow("approved", {
        registration: {
          ...regRow("approved").registration,
          checked_in_at: "2026-06-15T08:10:00.000Z",
        },
      }),
    ]);
    renderAuthed(<RegistrationsTable activityId="a-1" />);

    expect(await screen.findByText(/Điểm danh /)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Điểm danh thủ công" }),
    ).not.toBeInTheDocument();
  });

  it("approves a pending registration via POST /review", async () => {
    const user = userEvent.setup();
    const calls = mockRegs([regRow("pending")]);
    renderAuthed(<RegistrationsTable activityId="a-1" />);

    await user.click(await screen.findByRole("button", { name: "Duyệt" }));
    await waitFor(() =>
      expect(
        callsTo(calls, "POST", "/api/registrations/r-1/review")[0].body,
      ).toEqual({ action: "approve" }),
    );
  });

  it("rejects only after the inline confirm", async () => {
    const user = userEvent.setup();
    const calls = mockRegs([regRow("pending")]);
    renderAuthed(<RegistrationsTable activityId="a-1" />);

    await user.click(await screen.findByRole("button", { name: "Từ chối" }));
    expect(
      callsTo(calls, "POST", "/api/registrations/r-1/review"),
    ).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Xác nhận?" }));
    await waitFor(() =>
      expect(
        callsTo(calls, "POST", "/api/registrations/r-1/review")[0].body,
      ).toEqual({ action: "reject" }),
    );
  });

  it("offers manual check-in on approved, unchecked rows", async () => {
    const user = userEvent.setup();
    const calls = mockRegs([regRow("approved")]);
    renderAuthed(<RegistrationsTable activityId="a-1" />);

    await user.click(
      await screen.findByRole("button", { name: "Điểm danh thủ công" }),
    );
    await waitFor(() =>
      expect(
        callsTo(calls, "POST", "/api/registrations/r-1/checkin"),
      ).toHaveLength(1),
    );
  });

  it("refetches with ?status= when a filter tab is clicked", async () => {
    const calls = mockRegs([regRow("pending")]);
    const user = userEvent.setup();
    renderAuthed(<RegistrationsTable activityId="a-1" />);

    await screen.findByText("Trần Minh");
    await user.click(screen.getByRole("button", { name: "Chờ duyệt" }));

    await waitFor(() =>
      expect(
        callsTo(calls, "GET", "/api/activities/a-1/registrations").some(
          (call) => call.query.get("status") === "pending",
        ),
      ).toBe(true),
    );
  });

  it("shows Chưa có đăng ký when empty", async () => {
    mockRegs([]);
    renderAuthed(<RegistrationsTable activityId="a-1" />);
    expect(await screen.findByText("Chưa có đăng ký")).toBeInTheDocument();
  });
});
