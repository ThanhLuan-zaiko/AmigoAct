/**
 * Integration tests for `RealtimeProvider` — envelope → invalidation wiring
 * over a `FakeSocket`, plus the 4401 → logout path and teardown on logout.
 *
 * Layer: **integration**
 */
import { render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSocketStatus } from "@/components/realtime-provider";
import { getToken, TOKEN_STORAGE_KEY } from "@/lib/auth-storage";
import { FakeSocket } from "@/tests/helpers/fake-socket";
import {
  createTestQueryClient,
  TEST_AUTH,
  TestProviders,
  testMe,
} from "@/tests/helpers/render";
import { getMockRouter } from "@/tests/setup";

afterEach(() => {
  vi.unstubAllGlobals();
  FakeSocket.reset();
});

function StatusProbe() {
  const status = useSocketStatus();
  return <span data-testid="ws-status">{status}</span>;
}

/** Auth via a stored token + a healthy /me bootstrap. */
async function renderConnected(queryClient = createTestQueryClient()) {
  window.localStorage.setItem(TOKEN_STORAGE_KEY, TEST_AUTH.access_token);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(testMe())),
  );
  render(
    <TestProviders queryClient={queryClient} socketFactory={FakeSocket.factory}>
      <StatusProbe />
    </TestProviders>,
  );
  await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
  return queryClient;
}

describe("RealtimeProvider", () => {
  it("stays closed while anonymous — no socket is opened", async () => {
    render(
      <TestProviders socketFactory={FakeSocket.factory}>
        <StatusProbe />
      </TestProviders>,
    );

    await screen.findByText("closed");
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it("connects to /api/ws with the JWT once authenticated", async () => {
    await renderConnected();

    expect(FakeSocket.last().url).toBe(
      "ws://localhost:8100/api/ws?token=test.jwt.token",
    );
    act(() => FakeSocket.last().simulateOpen());
    expect(await screen.findByText("open")).toBeInTheDocument();
  });

  it("invalidates the mapped query keys for pushed envelopes", async () => {
    const queryClient = await renderConnected();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    act(() =>
      FakeSocket.last().simulateMessage({
        type: "activity.changed",
        data: { org_id: "o1", activity_id: "a1" },
      }),
    );

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["feed"] });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["org-activities", "o1"],
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["activity", "a1"] });
  });

  it("invalidates member/report prefixes on record.changed", async () => {
    const queryClient = await renderConnected();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    act(() =>
      FakeSocket.last().simulateMessage({
        type: "record.changed",
        data: { org_id: "o9", member_user_id: "u5" },
      }),
    );

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["me-records"] });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["member-records", "o9"],
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["reports", "o9"] });
  });

  it("logs out when the server rejects the token (close 4401)", async () => {
    await renderConnected();
    act(() => FakeSocket.last().simulateOpen());
    await screen.findByText("open");

    act(() => FakeSocket.last().simulateClose(4401));

    await waitFor(() =>
      expect(getMockRouter().replace).toHaveBeenCalledWith("/login"),
    );
    expect(getToken()).toBeNull();
    expect(await screen.findByText("closed")).toBeInTheDocument();
  });
});
