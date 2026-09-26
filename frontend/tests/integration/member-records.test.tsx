/**
 * Integration tests for `/orgs/[orgId]/members/[memberId]/records`
 * (MemberRecordsView + RecordsTable + RecordForm): the member header,
 * create/edit/delete mutations, the certificate blob download and the
 * honest empty/gate states. `fetch` routed through `mockApi`.
 *
 * Layer: **integration**
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemberRecordsView } from "@/app/orgs/[orgId]/members/[memberId]/records/member-records-view";
import type { MemberRole } from "@/lib/types";
import { callsTo, mockApi } from "@/tests/helpers/api-mock";
import { memberRecords, orgDetail, record } from "@/tests/helpers/fixtures";
import { renderAuthed } from "@/tests/helpers/render";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Same URL-subclass stub as in me-hours.test.tsx — see its comment. */
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

function mockMemberRecords(
  role: MemberRole = "manager",
  body = memberRecords({
    member_id: "m-9",
    full_name: "Trần Minh",
    email: "minh@example.com",
  }),
) {
  return mockApi({
    "GET /api/orgs/o-1": { body: orgDetail(role) },
    "GET /api/orgs/o-1/members/m-9/records": { body },
    "POST /api/orgs/o-1/members/m-9/records": {
      status: 201,
      body: { record: record({ id: "rec-new", title: "Mới" }) },
    },
    "PATCH /api/records/rec-1": {
      body: { record: record({ title: "Đổi tên" }) },
    },
    "DELETE /api/records/rec-1": { status: 204 },
    "GET /api/records/rec-1/certificate": () =>
      new Response(new Blob(["%PDF-1.4"], { type: "application/pdf" }), {
        status: 200,
      }),
  });
}

const VIEW = <MemberRecordsView orgId="o-1" memberId="m-9" />;

describe("MemberRecordsView", () => {
  it("renders the member header and the records table", async () => {
    const calls = mockMemberRecords();
    renderAuthed(VIEW);

    expect(
      await screen.findByRole("heading", { name: "Trần Minh" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /MSSV: SV2024 · CNTT01 · Công nghệ thông tin · minh@example.com/,
      ),
    ).toBeInTheDocument();
    // Record row: title, formatted day, hours/points, activity link.
    expect(screen.getByText("Hiến máu tình nguyện")).toBeInTheDocument();
    expect(screen.getByText("16/06/2026")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Xem hoạt động" })).toHaveAttribute(
      "href",
      "/activities/a-1",
    );
    expect(
      callsTo(calls, "GET", "/api/orgs/o-1/members/m-9/records"),
    ).toHaveLength(1);
  });

  it("creates a record via POST with the contract body", async () => {
    const user = userEvent.setup();
    const calls = mockMemberRecords();
    renderAuthed(VIEW);

    await user.click(
      await screen.findByRole("button", { name: "Ghi nhận thành tích" }),
    );
    await user.type(
      await screen.findByLabelText("Tên thành tích"),
      "Dọn rác bãi biển",
    );
    await user.type(screen.getByLabelText("Số giờ"), "5,5");
    await user.type(screen.getByLabelText("Điểm"), "3");
    fireEvent.change(screen.getByLabelText("Ngày ghi nhận"), {
      target: { value: "2026-06-20" },
    });
    await user.click(screen.getByRole("button", { name: "Ghi nhận" }));

    await waitFor(() => {
      const posts = callsTo(calls, "POST", "/api/orgs/o-1/members/m-9/records");
      expect(posts).toHaveLength(1);
      expect(posts[0].body).toEqual({
        title: "Dọn rác bãi biển",
        hours: 5.5,
        points: 3,
        awarded_on: "2026-06-20",
        note: null,
        evidence_url: null,
      });
    });
  });

  it("blocks submit on a missing title — no request fires", async () => {
    const user = userEvent.setup();
    const calls = mockMemberRecords();
    renderAuthed(VIEW);

    await user.click(
      await screen.findByRole("button", { name: "Ghi nhận thành tích" }),
    );
    await user.type(await screen.findByLabelText("Điểm"), "3");
    await user.click(screen.getByRole("button", { name: "Ghi nhận" }));

    expect(await screen.findByText("Nhập tên thành tích")).toBeInTheDocument();
    expect(
      callsTo(calls, "POST", "/api/orgs/o-1/members/m-9/records"),
    ).toHaveLength(0);
  });

  it("edits a record inline via PATCH", async () => {
    const user = userEvent.setup();
    const calls = mockMemberRecords();
    renderAuthed(VIEW);

    await user.click(await screen.findByRole("button", { name: "Sửa" }));
    const title = await screen.findByLabelText("Tên thành tích");
    expect(title).toHaveValue("Hiến máu tình nguyện");
    await user.clear(title);
    await user.type(title, "Hiến máu (sửa)");
    await user.click(screen.getByRole("button", { name: "Lưu thay đổi" }));

    await waitFor(() => {
      const patches = callsTo(calls, "PATCH", "/api/records/rec-1");
      expect(patches).toHaveLength(1);
      expect(patches[0].body).toMatchObject({ title: "Hiến máu (sửa)" });
    });
  });

  it("deletes a record behind the inline confirm", async () => {
    const user = userEvent.setup();
    const calls = mockMemberRecords();
    renderAuthed(VIEW);

    await user.click(await screen.findByRole("button", { name: "Xóa" }));
    await user.click(screen.getByRole("button", { name: "Xác nhận xóa?" }));

    await waitFor(() => {
      expect(callsTo(calls, "DELETE", "/api/records/rec-1")).toHaveLength(1);
    });
  });

  it("downloads the certificate blob", async () => {
    const click = stubBlobUrl();
    const user = userEvent.setup();
    const calls = mockMemberRecords();
    renderAuthed(VIEW);

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

  it("renders the honest empty state", async () => {
    mockMemberRecords("manager", {
      member: {
        member_id: "m-9",
        full_name: "Trần Minh",
        student_code: null,
        class_name: null,
        faculty: null,
        email: "minh@example.com",
      },
      records: [],
    });
    renderAuthed(VIEW);

    expect(await screen.findByText("Chưa có thành tích")).toBeInTheDocument();
  });

  it("locks non-managers out", async () => {
    const calls = mockMemberRecords("member");
    renderAuthed(VIEW);

    expect(await screen.findByText("Cần quyền quản lý")).toBeInTheDocument();
    expect(
      callsTo(calls, "GET", "/api/orgs/o-1/members/m-9/records"),
    ).toHaveLength(0);
  });
});
