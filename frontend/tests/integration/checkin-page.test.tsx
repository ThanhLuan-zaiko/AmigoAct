/**
 * Integration tests for `/checkin` (CheckinView): the QR-params confirm
 * card that never auto-submits, error mapping, and the no-params manual
 * flow (paste box + approved-activity picker). `fetch` mocked.
 *
 * Layer: **integration**
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CheckinView } from "@/app/checkin/checkin-view";
import type { MyRegistrationItem } from "@/lib/types";
import { callsTo, type MockCall, mockApi } from "@/tests/helpers/api-mock";
import {
  activityDetail,
  myRegItem,
  registration,
} from "@/tests/helpers/fixtures";
import { renderAuthed } from "@/tests/helpers/render";
import { setMockSearchString } from "@/tests/setup";

afterEach(() => {
  vi.unstubAllGlobals();
});

const CHECKIN_OK = {
  body: {
    registration: registration({ checked_in_at: "2026-06-15T08:10:00Z" }),
    already_checked_in: false,
    checked_in_count: 3,
  },
};

function mockCheckinPage(items: MyRegistrationItem[] = []): MockCall[] {
  return mockApi({
    "GET /api/activities/a-1": { body: activityDetail() },
    "POST /api/activities/a-1/checkin": CHECKIN_OK,
    "GET /api/me/registrations": { body: { registrations: items } },
  });
}

describe("CheckinView — QR params", () => {
  it("shows the confirm card and never auto-submits", async () => {
    setMockSearchString("?a=a-1&c=KM2P4R");
    const calls = mockCheckinPage();
    renderAuthed(<CheckinView />);

    expect(
      await screen.findByText("Điểm danh cho hoạt động này?"),
    ).toBeInTheDocument();
    expect(screen.getByText("KM2P4R")).toBeInTheDocument();
    expect(await screen.findByText("Hiến máu tình nguyện")).toBeInTheDocument();
    // The POST must wait for the explicit button press.
    expect(callsTo(calls, "POST", "/api/activities/a-1/checkin")).toHaveLength(
      0,
    );
  });

  it("posts the code on Điểm danh and links to the activity", async () => {
    const user = userEvent.setup();
    setMockSearchString("?a=a-1&c=km2p4r");
    const calls = mockCheckinPage();
    renderAuthed(<CheckinView />);

    await user.click(await screen.findByRole("button", { name: "Điểm danh" }));
    await waitFor(() =>
      expect(
        callsTo(calls, "POST", "/api/activities/a-1/checkin")[0].body,
      ).toEqual({ code: "KM2P4R" }),
    );
    expect(await screen.findByText("Điểm danh thành công")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Xem hoạt động" })).toHaveAttribute(
      "href",
      "/activities/a-1",
    );
  });

  it("maps wrong_checkin_code to Vietnamese", async () => {
    const user = userEvent.setup();
    setMockSearchString("?a=a-1&c=KM2P4R");
    mockApi({
      "GET /api/activities/a-1": { body: activityDetail() },
      "POST /api/activities/a-1/checkin": {
        status: 409,
        body: { code: "wrong_checkin_code", detail: "nope" },
      },
    });
    renderAuthed(<CheckinView />);

    await user.click(await screen.findByRole("button", { name: "Điểm danh" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Mã điểm danh không đúng",
    );
  });

  it("maps checkin_ended", async () => {
    const user = userEvent.setup();
    setMockSearchString("?a=a-1&c=KM2P4R");
    mockApi({
      "GET /api/activities/a-1": { body: activityDetail() },
      "POST /api/activities/a-1/checkin": {
        status: 409,
        body: { code: "checkin_ended", detail: "ended" },
      },
    });
    renderAuthed(<CheckinView />);

    await user.click(await screen.findByRole("button", { name: "Điểm danh" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Đã quá thời gian điểm danh",
    );
  });

  it("warns on a malformed QR link but still offers the manual flow", async () => {
    setMockSearchString("?a=a-1&c=!!!");
    mockCheckinPage();
    renderAuthed(<CheckinView />);

    expect(
      await screen.findByText(/Liên kết điểm danh không hợp lệ/),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Dán mã QR hoặc liên kết điểm danh"),
    ).toBeInTheDocument();
  });
});

describe("CheckinView — manual flow", () => {
  it("lists approved, unchecked registrations and links them", async () => {
    setMockSearchString("");
    mockCheckinPage([
      myRegItem("approved"),
      myRegItem("pending", {
        registration: registration({ id: "r-2", status: "pending" }),
      }),
      myRegItem("approved", {
        registration: registration({
          id: "r-3",
          checked_in_at: "2026-06-15T08:00:00Z",
        }),
      }),
    ]);
    renderAuthed(<CheckinView />);

    // Only the approved-and-unchecked item is offered.
    expect(
      await screen.findByRole("link", { name: /Hiến máu tình nguyện/ }),
    ).toHaveAttribute("href", "/activities/a-1");
    expect(
      screen.getAllByRole("link", { name: /Hiến máu tình nguyện/ }),
    ).toHaveLength(1);
  });

  it("shows the honest empty state", async () => {
    setMockSearchString("");
    mockCheckinPage([]);
    renderAuthed(<CheckinView />);

    expect(
      await screen.findByText("Không có hoạt động nào chờ điểm danh"),
    ).toBeInTheDocument();
  });

  it("parses a pasted full URL into the confirm card", async () => {
    const user = userEvent.setup();
    setMockSearchString("");
    mockCheckinPage();
    renderAuthed(<CheckinView />);

    await user.type(
      screen.getByLabelText("Dán mã QR hoặc liên kết điểm danh"),
      "https://app.example/checkin?a=a-1&c=KM2P4R",
    );
    await user.click(screen.getByRole("button", { name: "Tiếp tục" }));

    expect(
      await screen.findByText("Điểm danh cho hoạt động này?"),
    ).toBeInTheDocument();
  });

  it("keeps a bare code pending and points list links at /checkin", async () => {
    const user = userEvent.setup();
    setMockSearchString("");
    mockCheckinPage([myRegItem("approved")]);
    renderAuthed(<CheckinView />);

    await user.type(
      screen.getByLabelText("Dán mã QR hoặc liên kết điểm danh"),
      "KM2P4R",
    );
    await user.click(screen.getByRole("button", { name: "Tiếp tục" }));

    expect(await screen.findByText(/đã sẵn sàng/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Hiến máu tình nguyện/ }),
    ).toHaveAttribute("href", "/checkin?a=a-1&c=KM2P4R");
  });

  it("rejects an unparseable paste", async () => {
    const user = userEvent.setup();
    setMockSearchString("");
    mockCheckinPage();
    renderAuthed(<CheckinView />);

    await user.type(
      screen.getByLabelText("Dán mã QR hoặc liên kết điểm danh"),
      "garbage!!",
    );
    await user.click(screen.getByRole("button", { name: "Tiếp tục" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Không đọc được mã điểm danh",
    );
  });
});
