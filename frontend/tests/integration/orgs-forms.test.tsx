/**
 * Integration tests for `/orgs/new` (OrgForm) and `/orgs/join` (JoinForm) —
 * success paths navigate to the org page, contract errors map to
 * Vietnamese copy. `fetch` mocked; no real API.
 *
 * Layer: **integration**
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JoinForm } from "@/app/orgs/join/join-form";
import { OrgForm } from "@/app/orgs/new/org-form";
import { callsTo, mockApi } from "@/tests/helpers/api-mock";
import { renderAuthed } from "@/tests/helpers/render";
import { getMockRouter } from "@/tests/setup";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OrgForm — /orgs/new", () => {
  it("creates the org and navigates to it", async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      "POST /api/orgs": { body: { org: { id: "o-9" } } },
    });
    renderAuthed(<OrgForm />);

    await user.type(screen.getByLabelText("Mã tổ chức"), "CLB-MOI");
    await user.type(screen.getByLabelText("Tên tổ chức"), "CLB Mới");
    await user.click(screen.getByRole("button", { name: "Tạo tổ chức" }));

    await waitFor(() =>
      expect(getMockRouter().push).toHaveBeenCalledWith("/orgs/o-9"),
    );
    expect(callsTo(calls, "POST", "/api/orgs")[0].body).toEqual({
      code: "CLB-MOI",
      name: "CLB Mới",
    });
  });

  it("trims optional fields and omits the empty ones", async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      "POST /api/orgs": { body: { org: { id: "o-1" } } },
    });
    renderAuthed(<OrgForm />);

    await user.type(screen.getByLabelText("Mã tổ chức"), "CLB-X");
    await user.type(screen.getByLabelText("Tên tổ chức"), "  CLB X  ");
    await user.type(screen.getByLabelText("Mô tả"), "  Giới thiệu  ");
    await user.type(screen.getByLabelText("Email liên hệ"), " lienhe@x.com ");
    await user.click(screen.getByRole("button", { name: "Tạo tổ chức" }));

    await waitFor(() =>
      expect(getMockRouter().push).toHaveBeenCalledWith("/orgs/o-1"),
    );
    expect(callsTo(calls, "POST", "/api/orgs")[0].body).toEqual({
      code: "CLB-X",
      name: "CLB X",
      description: "Giới thiệu",
      contact_email: "lienhe@x.com",
    });
  });

  it("lands org_code_taken on the code field", async () => {
    const user = userEvent.setup();
    mockApi({
      "POST /api/orgs": {
        status: 409,
        body: { code: "org_code_taken", detail: "taken" },
      },
    });
    renderAuthed(<OrgForm />);

    await user.type(screen.getByLabelText("Mã tổ chức"), "CLB-TN");
    await user.type(screen.getByLabelText("Tên tổ chức"), "X");
    await user.click(screen.getByRole("button", { name: "Tạo tổ chức" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Mã tổ chức đã được sử dụng",
    );
    expect(getMockRouter().push).not.toHaveBeenCalled();
  });

  it("shows the generic banner for uncoded failures", async () => {
    const user = userEvent.setup();
    mockApi({
      "POST /api/orgs": {
        status: 500,
        body: { detail: "boom", code: "unexpected_response" },
      },
    });
    renderAuthed(<OrgForm />);

    await user.type(screen.getByLabelText("Mã tổ chức"), "CLB-X");
    await user.type(screen.getByLabelText("Tên tổ chức"), "X");
    await user.click(screen.getByRole("button", { name: "Tạo tổ chức" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Máy chủ trả về phản hồi không hợp lệ",
    );
  });
});

describe("JoinForm — /orgs/join", () => {
  it("joins an org and navigates to it", async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      "POST /api/orgs/join": { body: { org: { id: "o-7" } } },
    });
    renderAuthed(<JoinForm />);

    await user.type(screen.getByLabelText("Mã tham gia"), "CLB-TN");
    await user.type(screen.getByLabelText("Mã sinh viên"), "SV01");
    await user.type(screen.getByLabelText("Họ và tên hiển thị"), "Trần Minh");
    await user.click(screen.getByRole("button", { name: "Tham gia" }));

    await waitFor(() =>
      expect(getMockRouter().push).toHaveBeenCalledWith("/orgs/o-7"),
    );
    expect(callsTo(calls, "POST", "/api/orgs/join")[0].body).toEqual({
      code: "CLB-TN",
      student_code: "SV01",
      full_name: "Trần Minh",
    });
  });

  it("omits empty optional fields", async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      "POST /api/orgs/join": { body: { org: { id: "o-1" } } },
    });
    renderAuthed(<JoinForm />);

    await user.type(screen.getByLabelText("Mã tham gia"), "CLB-TN");
    await user.click(screen.getByRole("button", { name: "Tham gia" }));

    await waitFor(() =>
      expect(getMockRouter().push).toHaveBeenCalledWith("/orgs/o-1"),
    );
    expect(callsTo(calls, "POST", "/api/orgs/join")[0].body).toEqual({
      code: "CLB-TN",
    });
  });

  it("lands org_not_found on the code field", async () => {
    const user = userEvent.setup();
    mockApi({
      "POST /api/orgs/join": {
        status: 404,
        body: { code: "org_not_found", detail: "nope" },
      },
    });
    renderAuthed(<JoinForm />);

    await user.type(screen.getByLabelText("Mã tham gia"), "CLB-SAI");
    await user.click(screen.getByRole("button", { name: "Tham gia" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Không tìm thấy tổ chức với mã này",
    );
    expect(getMockRouter().push).not.toHaveBeenCalled();
  });

  it("lands student_code_taken on its own field", async () => {
    const user = userEvent.setup();
    mockApi({
      "POST /api/orgs/join": {
        status: 409,
        body: { code: "student_code_taken", detail: "dup" },
      },
    });
    renderAuthed(<JoinForm />);

    await user.type(screen.getByLabelText("Mã tham gia"), "CLB-TN");
    await user.type(screen.getByLabelText("Mã sinh viên"), "SV01");
    await user.click(screen.getByRole("button", { name: "Tham gia" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Mã sinh viên/);
  });
});
