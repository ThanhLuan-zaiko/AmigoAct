/**
 * Reusable WebSocket client — the realtime half of the app's backbone.
 *
 * Connects to `ws(s)://<api>/api/ws` (see `wsUrl` in `lib/config.ts`) and
 * speaks the shared JSON envelope protocol:
 *
 *   { "type": "<name>", "data": {...} }
 *
 * Features subscribe per message type via `on(type, handler)`; the socket
 * reconnects automatically with exponential backoff unless closed via
 * `close()`. `socketFactory` exists so tests inject a fake — production code
 * always uses the browser's real `WebSocket`.
 */
export interface SocketEnvelope {
  type: string;
  data?: unknown;
}

export type SocketStatus = "connecting" | "open" | "closed";

export type MessageHandler = (data: unknown, envelope: SocketEnvelope) => void;
export type StatusHandler = (status: SocketStatus) => void;
export type ErrorHandler = (error: Error) => void;

export interface SocketOptions {
  /** Full `ws://`/`wss://` URL, e.g. from `wsUrl("/api/ws")`. */
  url: string;
  /** JWT access token; appended as `?token=` (headers are impossible on WS). */
  token?: string;
  /** Reconnect after unexpected drops. Default `true`. */
  reconnect?: boolean;
  /** First retry delay in ms — doubles each attempt. Default 500. */
  reconnectDelayMs?: number;
  /** Cap for the backoff delay in ms. Default 8000. */
  maxReconnectDelayMs?: number;
  /** Test seam: replace the global `WebSocket` constructor. */
  socketFactory?: (url: string) => WebSocket;
}

export interface AmigoSocket {
  readonly status: SocketStatus;
  connect(): void;
  /** Send an envelope. Throws when the socket is not open — fail loudly. */
  send(type: string, data?: unknown): void;
  /** Subscribe to a message type. Returns an unsubscribe function. */
  on(type: string, handler: MessageHandler): () => void;
  /** Subscribe to status changes. Returns an unsubscribe function. */
  onStatus(handler: StatusHandler): () => void;
  /** Subscribe to protocol/transport errors. Returns an unsubscribe. */
  onError(handler: ErrorHandler): () => void;
  /** Close intentionally — no reconnect is scheduled. */
  close(): void;
}

export function createSocket(options: SocketOptions): AmigoSocket {
  const reconnect = options.reconnect ?? true;
  const baseDelay = options.reconnectDelayMs ?? 500;
  const maxDelay = options.maxReconnectDelayMs ?? 8_000;
  const factory =
    options.socketFactory ?? ((url: string) => new WebSocket(url));

  let socket: WebSocket | null = null;
  let status: SocketStatus = "closed";
  let manualClose = false;
  let attempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const messageHandlers = new Map<string, Set<MessageHandler>>();
  const statusHandlers = new Set<StatusHandler>();
  const errorHandlers = new Set<ErrorHandler>();

  const setStatus = (next: SocketStatus) => {
    status = next;
    for (const handler of statusHandlers) {
      handler(next);
    }
  };

  const reportError = (error: Error) => {
    for (const handler of errorHandlers) {
      handler(error);
    }
  };

  const fullUrl = () =>
    options.token
      ? `${options.url}?token=${encodeURIComponent(options.token)}`
      : options.url;

  const dispatch = (raw: unknown) => {
    let envelope: SocketEnvelope;
    try {
      envelope = JSON.parse(String(raw)) as SocketEnvelope;
    } catch {
      reportError(new Error("received a non-JSON WebSocket frame"));
      return;
    }
    if (typeof envelope.type !== "string") {
      reportError(new Error("WebSocket frame has no string 'type'"));
      return;
    }
    for (const handler of messageHandlers.get(envelope.type) ?? []) {
      handler(envelope.data, envelope);
    }
  };

  const openSocket = () => {
    setStatus("connecting");
    socket = factory(fullUrl());
    socket.onopen = () => {
      attempts = 0;
      setStatus("open");
    };
    socket.onmessage = (event) => dispatch(event.data);
    socket.onerror = () => reportError(new Error("WebSocket transport error"));
    socket.onclose = () => {
      setStatus("closed");
      if (!manualClose && reconnect) {
        attempts += 1;
        const delay = Math.min(baseDelay * 2 ** (attempts - 1), maxDelay);
        reconnectTimer = setTimeout(openSocket, delay);
      }
    };
  };

  return {
    get status() {
      return status;
    },
    connect() {
      if (socket && (status === "connecting" || status === "open")) {
        return;
      }
      manualClose = false;
      openSocket();
    },
    send(type, data) {
      if (!socket || status !== "open") {
        throw new Error(`cannot send '${type}' — WebSocket is not open`);
      }
      socket.send(
        JSON.stringify(data === undefined ? { type } : { type, data }),
      );
    },
    on(type, handler) {
      const handlers = messageHandlers.get(type) ?? new Set();
      handlers.add(handler);
      messageHandlers.set(type, handlers);
      return () => handlers.delete(handler);
    },
    onStatus(handler) {
      statusHandlers.add(handler);
      return () => statusHandlers.delete(handler);
    },
    onError(handler) {
      errorHandlers.add(handler);
      return () => errorHandlers.delete(handler);
    },
    close() {
      manualClose = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      socket?.close();
    },
  };
}
