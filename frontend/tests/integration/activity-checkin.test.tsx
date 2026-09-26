/**
 * Integration tests for the approved-registration check-in flow on
 * `/activities/[id]` (RegistrationPanel): client-side code validation,
 * POST normalization, success/idempotent states and the approved-but-
 * not-yet-checked-in cancel path. `fetch` mocked.
 *
 * Layer: **integration**
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActivityView } from "@/app/activities/[id]/activity-view";
import type { CheckinResponse } from "@/lib/types";
import {
  callsTo,
  type MockCall,
  type MockHandler,
  mockApi,
} from "@/tests/helpers/api-mock";
import {
  activityDetail,
  orgDetail,
  registration,
} from "@/tests/helpers/fixtures";
import { renderAuthed } from "@/tests/helpers/render";

afterEach(() => {
  vi.unstubAllGlobals();
});

const CHECKED_IN_REG = registration({
  status: "approved",
  checked_in_at: "2026-06-15T08:10:00.000Z",
});

const CHECKIN_OK: CheckinResponse = {
  registration: CHECKED_IN_REG,
  already_checked_in: false,
  checked_in_count: 3,
};

function mockCheckin(reply: MockHandler = { body: CHECKIN_OK }): MockCall[] {
  return mockApi({
    "GET /api/activities/a-1": {
      body: activityDetail({
        my_registration: registration({ status: "approved" }),
      }),
    },
    "GET /api/orgs/o-1": { body: orgDetail("member") },
    "POST /api/activities/a-1/checkin": reply,
  });
}

async function renderApproved(
  reply: MockHandler = { body: CHECKIN_OK },
): Promise<MockCall[]> {
  const calls = mockCheckin(reply);
  renderAuthed(<ActivityView activityId="a-1" />);
  await screen.findByRole("heading", { name: "Hiến máu tình nguyện" });
  return calls;
}

describe("RegistrationPanel — approved, not yet checked in", () => {
  it("rejects a malformed code locally (no POST)", async () => {
    const user = userEvent.setup();
    const calls = await renderApproved();

    await user.type(screen.getByLabelText("Mã điểm danh"), "0OI1");
    await user.click(screen.getByRole("button", { name: "Điểm danh" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Mã điểm danh gồm 6 ký tự hợp lệ",
    );
    expect(callsTo(calls, "POST", "/api/activities/a-1/checkin")).toHaveLength(
      0,
    );
  });

  it("normalizes the code and posts it", async () => {
    const user = userEvent.setup();
    const calls = await renderApproved();

    await user.type(screen.getByLabelText("Mã điểm danh"), " km2p4r ");
    await user.click(screen.getByRole("button", { name: "Điểm danh" }));

    await waitFor(() =>
      expect(
        callsTo(calls, "POST", "/api/activities/a-1/checkin")[0].body,
      ).toEqual({ code: "KM2P4R" }),
    );
    expect(
      await screen.findByText(/Điểm danh thành công lúc/),
    ).toBeInTheDocument();
  });

  it("shows the idempotent already_checked_in copy", async () => {
    const user = userEvent.setup();
    await renderApproved({
      body: { ...CHECKIN_OK, already_checked_in: true },
    });

    await user.type(screen.getByLabelText("Mã điểm danh"), "KM2P4R");
    await user.click(screen.getByRole("button", { name: "Điểm danh" }));

    expect(await screen.findByText(/Bạn đã điểm danh lúc/)).toBeInTheDocument();
  });

  it("maps wrong_checkin_code to Vietnamese", async () => {
    const user = userEvent.setup();
    await renderApproved({
      status: 409,
      body: { code: "wrong_checkin_code", detail: "nope" },
    });

    await user.type(screen.getByLabelText("Mã điểm danh"), "KM2P4R");
    await user.click(screen.getByRole("button", { name: "Điểm danh" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Mã điểm danh không đúng",
    );
  });

  it("still offers cancel while not checked in", async () => {
    await renderApproved();
    expect(
      screen.getByRole("button", { name: "Hủy đăng ký" }),
    ).toBeInTheDocument();
  });
});

describe("RegistrationPanel — already checked in", () => {
  it("shows the checked-in time and no cancel", async () => {
    mockApi({
      "GET /api/activities/a-1": {
        body: activityDetail({ my_registration: CHECKED_IN_REG }),
      },
      "GET /api/orgs/o-1": { body: orgDetail("member") },
    });
    renderAuthed(<ActivityView activityId="a-1" />);

    await screen.findByRole("heading", { name: "Hiến máu tình nguyện" });
    expect(screen.getByText(/Đã điểm danh lúc/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Hủy đăng ký" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Mã điểm danh")).not.toBeInTheDocument();
  });
});
