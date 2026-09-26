/**
 * A fake `WebSocket` for tests — created through a `socketFactory` seam, it
 * records instances/sends and exposes `simulate*` drivers. No real network.
 */

export class FakeSocket {
  static instances: FakeSocket[] = [];

  readonly url: string;
  readyState = 0;
  sent: string[] = [];
  closed = false;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  static reset(): void {
    FakeSocket.instances = [];
  }

  static last(): FakeSocket {
    const socket = FakeSocket.instances.at(-1);
    if (!socket) {
      throw new Error("no socket was created");
    }
    return socket;
  }

  static factory(url: string): WebSocket {
    return new FakeSocket(url) as unknown as WebSocket;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  }

  simulateOpen(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  simulateMessage(envelope: { type: string; data?: unknown }): void {
    this.onmessage?.({ data: JSON.stringify(envelope) });
  }

  /** An abnormal drop (code 1006) — the client should reconnect. */
  simulateDrop(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1006 });
  }

  /** A server-initiated close with an arbitrary code (e.g. 4401 auth fail). */
  simulateClose(code: number): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}
