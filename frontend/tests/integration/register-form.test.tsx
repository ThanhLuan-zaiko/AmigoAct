/**
 * Integration tests for the register flow — client-side confirm check plus
 * the Vietnamese error surface for server rejections.
 *
 * Layer: **integration**
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import RegisterPage from "@/app/register/page";
import { getToken } from "@/lib/auth-storage";
import { FakeSocket } from "@/tests/helpers/fake-socket";
import { TEST_AUTH, TestProviders } from "@/tests/helpers/render";
import { getMockRouter } from "@/tests/setup";

afterEach(() => {
  vi.unstubAllGlobals();
  FakeSocket.reset();
});

function renderRegister() {
  return render(
    <TestProviders socketFactory={FakeSocket.factory}>
      <RegisterPage />
    </TestProviders>,
  );
}

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Họ và tên"), "Nguyễn Lan");
  await user.type(screen.getByLabelText("Email"), "lan@example.com");
  await user.type(
    screen.getByLabelText("Mật khẩu", { exact: true }),
    "mậtkhẩu123",
  );
}

describe("RegisterPage", () => {
  it("renders the Vietnamese form", async () => {
    renderRegister();

    expect(
      await screen.findByRole("heading", { name: "Tạo tài khoản" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Họ và tên")).toBeInTheDocument();
    expect(screen.getByLabelText("Nhập lại mật khẩu")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Đăng nhập" })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("registers, signs in and lands on the dashboard", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => Response.json(TEST_AUTH));
    vi.stubGlobal("fetch", fetchMock);
    renderRegister();

    await fillValidForm(user);
    await user.type(screen.getByLabelText("Nhập lại mật khẩu"), "mậtkhẩu123");
    await user.click(screen.getByRole("button", { name: "Tạo tài khoản" }));

    await waitFor(() =>
      expect(getMockRouter().replace).toHaveBeenCalledWith("/dashboard"),
    );
    expect(getToken()).toBe(TEST_AUTH.access_token);

    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body))).toEqual({
      full_name: "Nguyễn Lan",
      email: "lan@example.com",
      password: "mậtkhẩu123",
    });
  });

  it("blocks mismatched confirmation without calling the API", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderRegister();

    await fillValidForm(user);
    await user.type(screen.getByLabelText("Nhập lại mật khẩu"), "khac12345");
    await user.click(screen.getByRole("button", { name: "Tạo tài khoản" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Mật khẩu nhập lại không khớp",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces email_taken in Vietnamese", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { detail: "email already registered", code: "email_taken" },
          { status: 409 },
        ),
      ),
    );
    renderRegister();

    await fillValidForm(user);
    await user.type(screen.getByLabelText("Nhập lại mật khẩu"), "mậtkhẩu123");
    await user.click(screen.getByRole("button", { name: "Tạo tài khoản" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Email này đã được đăng ký",
    );
  });

  it("surfaces password_too_short in Vietnamese", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            detail: "password must be at least 8 characters",
            code: "password_too_short",
          },
          { status: 422 },
        ),
      ),
    );
    renderRegister();

    await fillValidForm(user);
    await user.type(screen.getByLabelText("Nhập lại mật khẩu"), "mậtkhẩu123");
    await user.click(screen.getByRole("button", { name: "Tạo tài khoản" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Mật khẩu cần ít nhất 8 ký tự",
    );
  });
});
