/**
 * Shared test harness: the same provider stack `Providers` mounts in
 * `app/layout.tsx`, with per-test seams — an isolated QueryClient and an
 * injectable socket factory (pass `FakeSocket.factory` so authenticated
 * tests never touch a real WebSocket).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { AuthProvider, useAuth } from "@/components/auth-provider";
import { RealtimeProvider } from "@/components/realtime-provider";
import { ThemeProvider } from "@/components/theme-provider";
import type { AuthResponse, MeResponse } from "@/lib/types";
import { FakeSocket } from "@/tests/helpers/fake-socket";

/** A client with honest defaults for tests: no retries, no stale grace. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

export interface TestProvidersProps {
  children: ReactNode;
  /** Pass to inspect cache/invalidations after the fact. */
  queryClient?: QueryClient;
  /** Pass `FakeSocket.factory` in tests that reach authenticated state. */
  socketFactory?: (url: string) => WebSocket;
}

export function TestProviders({
  children,
  queryClient,
  socketFactory,
}: TestProvidersProps) {
  const [client] = useState(() => queryClient ?? createTestQueryClient());
  return (
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <RealtimeProvider socketFactory={socketFactory}>
            {children}
          </RealtimeProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

/** A valid-looking `AuthResponse` for sign-in driven tests. */
export const TEST_AUTH: AuthResponse = {
  access_token: "test.jwt.token",
  token_type: "bearer",
  user: {
    id: "0191e2b3-4c5d-7e8f-9a0b-1c2d3e4f5a6b",
    email: "lan@example.com",
    full_name: "Nguyễn Lan",
    phone: null,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
  },
};

/** A valid-looking `MeResponse` (no memberships by default). */
export function testMe(
  memberships: MeResponse["memberships"] = [],
): MeResponse {
  return { user: TEST_AUTH.user, memberships };
}

/**
 * Signs the mounted session in with `auth` on mount — skips the bootstrap
 * fetch entirely, so the `qk.me` cache stays empty and queries run for real.
 */
export function SignInProbe({ auth }: { auth: AuthResponse }) {
  const { signIn } = useAuth();
  useEffect(() => {
    signIn(auth);
  }, [signIn, auth]);
  return null;
}

/**
 * Render `ui` inside the full test provider stack with an authenticated
 * session (via `SignInProbe`) and a FakeSocket on the realtime channel.
 */
export function renderAuthed(ui: ReactNode, queryClient?: QueryClient) {
  return render(
    <TestProviders socketFactory={FakeSocket.factory} queryClient={queryClient}>
      <SignInProbe auth={TEST_AUTH} />
      {ui}
    </TestProviders>,
  );
}
