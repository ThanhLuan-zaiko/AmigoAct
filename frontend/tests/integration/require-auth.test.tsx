/**
 * Integration tests for `<RequireAuth>` — the anonymous/loading/authenticated
 * gate around protected pages.
 *
 * Layer: **integration**
 */
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RequireAuth } from "@/components/require-auth";
import { TOKEN_STORAGE_KEY } from "@/lib/auth-storage";
import { FakeSocket } from "@/tests/helpers/fake-socket";
import { TEST_AUTH, TestProviders, testMe } from "@/tests/helpers/render";
import { getMockRouter, setMockPathname } from "@/tests/setup";

afterEach(() => {
  vi.unstubAllGlobals();
  FakeSocket.reset();
});

function renderGate() {
  return render(
    <TestProviders socketFactory={FakeSocket.factory}>
      <RequireAuth>
        <p>vùng bảo vệ</p>
      </RequireAuth>
    </TestProviders>,
  );
}

describe("RequireAuth", () => {
  it("shows the checking state while the session resolves", () => {
    // A stored token + a fetch that never resolves ⇒ status stays "loading".
    window.localStorage.setItem(TOKEN_STORAGE_KEY, "pending.jwt");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    renderGate();

    expect(screen.getByRole("status")).toHaveTextContent(
      "Đang kiểm tra đăng nhập…",
    );
    expect(screen.queryByText("vùng bảo vệ")).not.toBeInTheDocument();
  });

  it("redirects anonymous visitors to /login?next=<path>", async () => {
    setMockPathname("/dashboard");
    renderGate(); // no token stored ⇒ anonymous

    await waitFor(() =>
      expect(getMockRouter().replace).toHaveBeenCalledWith(
        "/login?next=%2Fdashboard",
      ),
    );
    expect(screen.queryByText("vùng bảo vệ")).not.toBeInTheDocument();
  });

  it("renders children once authenticated", async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, TEST_AUTH.access_token);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(testMe())),
    );
    renderGate();

    expect(await screen.findByText("vùng bảo vệ")).toBeInTheDocument();
    expect(getMockRouter().replace).not.toHaveBeenCalled();
  });
});
