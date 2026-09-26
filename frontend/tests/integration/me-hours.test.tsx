/**
 * Integration tests for `/me/hours` (HoursView): totals cards, per-org
 * chips, the records table, the certificate blob download and honest
 * empty/error states. `fetch` is routed through `mockApi`.
 *
 * Layer: **integration**
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HoursView } from "@/app/me/hours/hours-view";
import { callsTo, mockApi } from "@/tests/helpers/api-mock";
import { myRecordItem, myRecords, record } from "@/tests/helpers/fixtures";
import { renderAuthed } from "@/tests/helpers/render";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * Stub the object-URL API + anchor click. `URL` is replaced by a
 * subclass — a plain `{...URL}` object would break `new URL()` inside
 * `mockApi` (spread of a class drops constructability).
 */
function stubBlobUrl() {
  class MockURL extends URL {
    static override createObjectURL(): string {
      return "blob:mock/0";
    }
    static override revokeObjectURL(): void {}
  }
  vi.stubGlobal("URL", MockURL);
  return vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
}

describe("HoursView", () => {
  it("renders totals, per-org chips and the record rows", async () => {
    const calls = mockApi({
      "GET /api/me/records": {
        body: myRecords({
          records: [
            myRecordItem(),
            myRecordItem({
              record: record({
                id: "rec-2",
                title: "Mùa hè xanh",
                hours: null,
                activity_id: null,
                registration_id: null,
              }),
              activity: null,
            }),
          ],
        }),
      },
    });
    renderAuthed(<HoursView />);

    expect(
      await screen.findByRole("heading", { name: "Giờ tình nguyện" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Tổng giờ tình nguyện")).toBeInTheDocument();
    // 4 hours → vi-VN "4"; 2.5 points → "2,5" (card + row cells).
    expect(screen.getAllByText("2,5").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Tổng điểm")).toBeInTheDocument();
    // "Số thành tích" counts both records.
    expect(screen.getByText("Số thành tích")).toBeInTheDocument();

    // The per-org chip carries the org name and hour total (the name
    // also appears in each record row — the chip renders first).
    expect(
      screen.getAllByText(/CLB Tình nguyện/)[0].closest("span"),
    ).toHaveTextContent("4 giờ");

    // Rows: linked activity title under the record title, "—" for null hours.
    expect(
      screen.getByRole("link", { name: "Hiến máu tình nguyện" }),
    ).toHaveAttribute("href", "/activities/a-1");
    expect(screen.getByText("Mùa hè xanh")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Tải chứng nhận" }),
    ).toHaveLength(2);
    expect(callsTo(calls, "GET", "/api/me/records")).toHaveLength(1);
  });

  it("downloads the certificate blob as chung-nhan-<id>.pdf", async () => {
    const click = stubBlobUrl();
    const user = userEvent.setup();
    const calls = mockApi({
      "GET /api/me/records": { body: myRecords() },
      "GET /api/records/rec-1/certificate": () =>
        new Response(new Blob(["%PDF-1.4"], { type: "application/pdf" }), {
          status: 200,
        }),
    });
    renderAuthed(<HoursView />);

    await user.click(
      await screen.findByRole("button", { name: "Tải chứng nhận" }),
    );

    await waitFor(() => {
      expect(
        callsTo(calls, "GET", "/api/records/rec-1/certificate"),
      ).toHaveLength(1);
    });
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.href).toMatch(/^blob:/);
    expect(anchor.download).toBe("chung-nhan-rec-1.pdf");
  });

  it("shows a per-row error when the certificate download fails", async () => {
    stubBlobUrl();
    const user = userEvent.setup();
    mockApi({
      "GET /api/me/records": { body: myRecords() },
      "GET /api/records/rec-1/certificate": {
        status: 404,
        body: { detail: "not found", code: "record_not_found" },
      },
    });
    renderAuthed(<HoursView />);

    await user.click(
      await screen.findByRole("button", { name: "Tải chứng nhận" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Không tìm thấy thành tích",
    );
  });

  it("renders the honest empty state", async () => {
    mockApi({
      "GET /api/me/records": {
        body: myRecords({
          totals: { hours: 0, points: 0 },
          by_org: [],
          records: [],
        }),
      },
    });
    renderAuthed(<HoursView />);

    expect(
      await screen.findByText("Bạn chưa có thành tích nào"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Xem hoạt động" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
    // Totals still render — as honest zeros.
    expect(screen.getByText("Tổng giờ tình nguyện")).toBeInTheDocument();
  });

  it("shows the error banner when the query fails", async () => {
    mockApi({
      "GET /api/me/records": {
        status: 500,
        body: { detail: "boom", code: "unexpected" },
      },
    });
    renderAuthed(<HoursView />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Có lỗi xảy ra, thử lại sau",
    );
  });
});
