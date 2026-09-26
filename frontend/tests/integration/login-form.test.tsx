/**
 * Integration tests for the login flow — the form drives `useMutation`
 * against a mocked `fetch`, `signIn` persists the token, and the router is
 * the `next/navigation` mock from `tests/setup.ts`.
 *
 * Layer: **integration**
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import LoginPage from "@/app/login/page";
import { getToken, TOKEN_STORAGE_KEY } from "@/lib/auth-storage";
import { DEFAULT_API_URL } from "@/lib/config";
import { FakeSocket } from "@/tests/helpers/fake-socket";
import { TEST_AUTH, TestProviders } from "@/tests/helpers/render";
import { getMockRouter, setMockSearchString } from "@/tests/setup";

afterEach(() => {
  vi.unstubAllGlobals();
  FakeSocket.reset();
});

function renderLogin() {
  return render(
    <TestProviders socketFactory={FakeSocket.factory}>
      <LoginPage />
    </TestProviders>,
  );
}

describe("LoginPage", () => {
  it("renders the Vietnamese form", async () => {
    renderLogin();

    expect(
      await screen.findByRole("heading", { name: "Đăng nhập" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Mật khẩu")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tạo tài khoản" })).toHaveAttribute(
      "href",
      "/register",
    );
  });

  it("signs in on a successful POST and goes to the dashboard", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => Response.json(TEST_AUTH));
    vi.stubGlobal("fetch", fetchMock);
    renderLogin();

    await user.type(screen.getByLabelText("Email"), " lan@example.com ");
    await user.type(screen.getByLabelText("Mật khẩu"), "mậtkhẩu123");
    await user.click(screen.getByRole("button", { name: "Đăng nhập" }));

    await waitFor(() =>
      expect(getMockRouter().replace).toHaveBeenCalledWith("/dashboard"),
    );
    expect(getToken()).toBe(TEST_AUTH.access_token);
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBe(
      "test.jwt.token",
    );

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(`${DEFAULT_API_URL}/api/auth/login`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      email: "lan@example.com",
      password: "mậtkhẩu123",
    });
  });

  it("honours a safe ?next= redirect target", async () => {
    const user = userEvent.setup();
    setMockSearchString("next=/me/hours");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(TEST_AUTH)),
    );
    renderLogin();

    await user.type(screen.getByLabelText("Email"), "lan@example.com");
    await user.type(screen.getByLabelText("Mật khẩu"), "mậtkhẩu123");
    await user.click(screen.getByRole("button", { name: "Đăng nhập" }));

    await waitFor(() =>
      expect(getMockRouter().replace).toHaveBeenCalledWith("/me/hours"),
    );
  });

  it("rejects an off-site ?next= and falls back to the dashboard", async () => {
    const user = userEvent.setup();
    setMockSearchString("next=https://evil.example/steal");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(TEST_AUTH)),
    );
    renderLogin();

    await user.type(screen.getByLabelText("Email"), "lan@example.com");
    await user.type(screen.getByLabelText("Mật khẩu"), "mậtkhẩu123");
    await user.click(screen.getByRole("button", { name: "Đăng nhập" }));

    await waitFor(() =>
      expect(getMockRouter().replace).toHaveBeenCalledWith("/dashboard"),
    );
    expect(getMockRouter().replace).not.toHaveBeenCalledWith(
      "https://evil.example/steal",
    );
  });

  it("shows the Vietnamese credential error on a 401", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { detail: "Invalid credentials", code: "invalid_credentials" },
          { status: 401 },
        ),
      ),
    );
    renderLogin();

    await user.type(screen.getByLabelText("Email"), "lan@example.com");
    await user.type(screen.getByLabelText("Mật khẩu"), "sai-mat-khau");
    await user.click(screen.getByRole("button", { name: "Đăng nhập" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Email hoặc mật khẩu không đúng",
    );
  });

  it("redirects away when a session is already authenticated", async () => {
    // A stored token + healthy /me means the user is already signed in.
    window.localStorage.setItem(TOKEN_STORAGE_KEY, TEST_AUTH.access_token);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ user: TEST_AUTH.user, memberships: [] }),
      ),
    );
    renderLogin();

    await waitFor(() =>
      expect(getMockRouter().replace).toHaveBeenCalledWith("/dashboard"),
    );
  });
});
