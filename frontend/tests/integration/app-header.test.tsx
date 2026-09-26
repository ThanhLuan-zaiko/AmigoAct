/**
 * Integration tests for `AppHeader` — auth-aware chrome: login/register
 * links for anonymous visitors, nav + status dot + logout for members.
 *
 * Layer: **integration**
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppHeader } from "@/components/app-header";
import { getToken, TOKEN_STORAGE_KEY } from "@/lib/auth-storage";
import { FakeSocket } from "@/tests/helpers/fake-socket";
import { TEST_AUTH, TestProviders, testMe } from "@/tests/helpers/render";
import { getMockRouter } from "@/tests/setup";

afterEach(() => {
  vi.unstubAllGlobals();
  FakeSocket.reset();
});

function renderHeader() {
  return render(
    <TestProviders socketFactory={FakeSocket.factory}>
      <AppHeader />
    </TestProviders>,
  );
}

async function renderAuthenticatedHeader() {
  window.localStorage.setItem(TOKEN_STORAGE_KEY, TEST_AUTH.access_token);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(testMe())),
  );
  const view = renderHeader();
  await screen.findByText("Nguyễn Lan");
  return view;
}

describe("AppHeader (anonymous)", () => {
  it("shows brand, theme toggle and auth links", async () => {
    renderHeader();

    expect(screen.getByRole("link", { name: "AmigoAct" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(
      screen.getByRole("button", { name: "Chuyển sang giao diện tối" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("link", { name: "Đăng nhập" }),
    ).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "Tạo tài khoản" })).toHaveAttribute(
      "href",
      "/register",
    );
    expect(
      screen.queryByRole("button", { name: /Đăng xuất/ }),
    ).not.toBeInTheDocument();
  });
});

describe("AppHeader (authenticated)", () => {
  it("shows nav, user name and realtime status", async () => {
    await renderAuthenticatedHeader();

    // Brand now targets the dashboard and the nav link exists.
    expect(screen.getByRole("link", { name: "AmigoAct" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
    expect(screen.getByRole("link", { name: "Bảng tin" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
    expect(screen.getByText("Nguyễn Lan")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Đăng nhập" }),
    ).not.toBeInTheDocument();

    // The socket connects for the authenticated session.
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    act(() => FakeSocket.last().simulateOpen());
    expect(await screen.findByText("Đã kết nối")).toBeInTheDocument();
  });

  it("logs out: clears the token and navigates to /login", async () => {
    const user = userEvent.setup();
    await renderAuthenticatedHeader();

    await user.click(screen.getByRole("button", { name: /Đăng xuất/ }));

    expect(getToken()).toBeNull();
    expect(getMockRouter().replace).toHaveBeenCalledWith("/login");
    // The socket is torn down with the session.
    await waitFor(() => expect(FakeSocket.last().closed).toBe(true));
  });
});
