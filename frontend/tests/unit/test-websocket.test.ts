/**
 * Unit tests for `lib/websocket.ts` — the reusable realtime client.
 * `FakeSocket` (tests/helpers) replaces the global `WebSocket` via
 * `socketFactory`; `vi.useFakeTimers` drives the reconnect backoff.
 * No network is touched.
 *
 * Layer: **unit**
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSocket,
  WS_AUTH_CLOSE_CODE,
  WS_AUTH_ERROR_MESSAGE,
} from "@/lib/websocket";
import { FakeSocket } from "@/tests/helpers/fake-socket";

const factory = FakeSocket.factory;
const lastSocket = FakeSocket.last;

beforeEach(() => {
  FakeSocket.reset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createSocket", () => {
  it("connects to the given URL and reports status changes", () => {
    const socket = createSocket({
      url: "ws://localhost:8100/api/ws",
      socketFactory: factory,
    });
    const statuses: string[] = [];
    socket.onStatus((s) => statuses.push(s));

    socket.connect();
    lastSocket().simulateOpen();

    expect(lastSocket().url).toBe("ws://localhost:8100/api/ws");
    expect(socket.status).toBe("open");
    expect(statuses).toEqual(["connecting", "open"]);
  });

  it("appends the JWT as a token query parameter", () => {
    createSocket({
      url: "ws://localhost:8100/api/ws",
      token: "jwt.with space/slash",
      socketFactory: factory,
    }).connect();

    expect(lastSocket().url).toBe(
      "ws://localhost:8100/api/ws?token=jwt.with%20space%2Fslash",
    );
  });

  it("sends the shared envelope shape", () => {
    const socket = createSocket({
      url: "ws://x",
      socketFactory: factory,
    });
    socket.connect();
    lastSocket().simulateOpen();

    socket.send("ping");
    socket.send("subscribe", { topic: "activities" });

    expect(lastSocket().sent).toEqual([
      '{"type":"ping"}',
      '{"type":"subscribe","data":{"topic":"activities"}}',
    ]);
  });

  it("throws when sending on a socket that is not open", () => {
    const socket = createSocket({ url: "ws://x", socketFactory: factory });
    socket.connect();

    expect(() => socket.send("ping")).toThrow("not open");
  });

  it("dispatches incoming envelopes to handlers by type", () => {
    const socket = createSocket({ url: "ws://x", socketFactory: factory });
    const received: unknown[] = [];
    socket.on("announce", (data) => received.push(data));
    socket.connect();
    lastSocket().simulateOpen();

    lastSocket().simulateMessage({ type: "announce", data: { n: 1 } });
    lastSocket().simulateMessage({ type: "other" });

    expect(received).toEqual([{ n: 1 }]);
  });

  it("reports malformed frames through onError instead of throwing", () => {
    const socket = createSocket({ url: "ws://x", socketFactory: factory });
    const errors: string[] = [];
    socket.onError((e) => errors.push(e.message));
    socket.connect();
    lastSocket().simulateOpen();

    lastSocket().onmessage?.({ data: "not json" });
    lastSocket().onmessage?.({ data: JSON.stringify({ noType: true }) });

    expect(errors).toEqual([
      "received a non-JSON WebSocket frame",
      "WebSocket frame has no string 'type'",
    ]);
  });

  it("reconnects with backoff after an unexpected drop", () => {
    const socket = createSocket({
      url: "ws://x",
      socketFactory: factory,
      reconnectDelayMs: 500,
    });
    socket.connect();
    lastSocket().simulateOpen();

    lastSocket().simulateDrop();
    expect(FakeSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(500);
    expect(FakeSocket.instances).toHaveLength(2);

    lastSocket().simulateDrop();
    vi.advanceTimersByTime(1000); // backoff doubled
    expect(FakeSocket.instances).toHaveLength(3);
  });

  it("does not reconnect after an intentional close", () => {
    const socket = createSocket({ url: "ws://x", socketFactory: factory });
    socket.connect();
    lastSocket().simulateOpen();

    socket.close();
    vi.advanceTimersByTime(10_000);

    expect(FakeSocket.instances).toHaveLength(1);
    expect(socket.status).toBe("closed");
  });
});

describe("authentication rejection (close code 4401)", () => {
  it("does not reconnect and reports an auth failure", () => {
    const socket = createSocket({
      url: "ws://x",
      socketFactory: factory,
      reconnectDelayMs: 500,
    });
    const errors: string[] = [];
    socket.onError((e) => errors.push(e.message));
    socket.connect();
    lastSocket().simulateOpen();

    lastSocket().simulateClose(WS_AUTH_CLOSE_CODE);
    vi.advanceTimersByTime(60_000);

    expect(FakeSocket.instances).toHaveLength(1);
    expect(socket.status).toBe("closed");
    expect(errors).toEqual([WS_AUTH_ERROR_MESSAGE]);
    expect(errors[0]).toBe("WebSocket authentication rejected");
  });

  it("still reports status as closed through onStatus", () => {
    const socket = createSocket({ url: "ws://x", socketFactory: factory });
    const statuses: string[] = [];
    socket.onStatus((s) => statuses.push(s));
    socket.connect();
    lastSocket().simulateOpen();

    lastSocket().simulateClose(WS_AUTH_CLOSE_CODE);

    expect(statuses).toEqual(["connecting", "open", "closed"]);
  });

  it("keeps reconnecting for other unexpected close codes", () => {
    const socket = createSocket({
      url: "ws://x",
      socketFactory: factory,
      reconnectDelayMs: 100,
    });
    const errors: string[] = [];
    socket.onError((e) => errors.push(e.message));
    socket.connect();
    lastSocket().simulateOpen();

    lastSocket().simulateClose(1011); // server error — not an auth rejection
    vi.advanceTimersByTime(100);

    expect(FakeSocket.instances).toHaveLength(2);
    expect(errors).toEqual([]);
  });
});
