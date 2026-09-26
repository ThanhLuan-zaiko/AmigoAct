"use client";

/**
 * The realtime half of the app spine.
 *
 * While a session is authenticated it opens the shared WebSocket channel
 * (`ws(s)://<api>/api/ws?token=<jwt>`) and translates every pushed envelope
 * into TanStack Query invalidations via `realtimeInvalidations` — live
 * screens refresh without any fetch/poll code of their own. A `4401` close
 * (dead token) ends the session through `logout`.
 *
 * `socketFactory` exists only as a test seam — production mounts this
 * provider without it and gets the browser's real `WebSocket`.
 */
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { useAuth } from "@/components/auth-provider";
import { wsUrl } from "@/lib/config";
import {
  REALTIME_EVENT_TYPES,
  realtimeInvalidations,
} from "@/lib/realtime-events";
import {
  createSocket,
  type SocketStatus,
  WS_AUTH_ERROR_MESSAGE,
} from "@/lib/websocket";

const SocketStatusContext = createContext<SocketStatus>("closed");

/** Socket connection state for UI chrome (e.g. the header status dot). */
export function useSocketStatus(): SocketStatus {
  return useContext(SocketStatusContext);
}

export interface RealtimeProviderProps {
  children: ReactNode;
  /** Test seam — replaces the real `WebSocket` constructor. */
  socketFactory?: (url: string) => WebSocket;
}

export function RealtimeProvider({
  children,
  socketFactory,
}: RealtimeProviderProps) {
  const { status, token, logout } = useAuth();
  const queryClient = useQueryClient();
  const [socketStatus, setSocketStatus] = useState<SocketStatus>("closed");

  // A ref keeps the socket effect independent of `logout`'s identity so the
  // channel isn't torn down and rebuilt on unrelated re-renders.
  const logoutRef = useRef(logout);
  useEffect(() => {
    logoutRef.current = logout;
  });

  useEffect(() => {
    if (status !== "authenticated" || token === null) {
      setSocketStatus("closed");
      return;
    }

    const socket = createSocket({
      url: wsUrl("/api/ws"),
      token,
      socketFactory,
    });
    const unsubscribe = [
      socket.onStatus(setSocketStatus),
      ...REALTIME_EVENT_TYPES.map((type) =>
        socket.on(type, (_data, envelope) => {
          for (const queryKey of realtimeInvalidations(envelope)) {
            void queryClient.invalidateQueries({ queryKey });
          }
        }),
      ),
      socket.onError((error) => {
        if (error.message === WS_AUTH_ERROR_MESSAGE) {
          logoutRef.current();
        }
      }),
    ];
    socket.connect();

    return () => {
      for (const off of unsubscribe) {
        off();
      }
      socket.close();
    };
  }, [status, token, queryClient, socketFactory]);

  return (
    <SocketStatusContext.Provider value={socketStatus}>
      {children}
    </SocketStatusContext.Provider>
  );
}
