"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

import { AppHeader } from "@/components/app-header";
import { AuthProvider } from "@/components/auth-provider";
import { RealtimeProvider } from "@/components/realtime-provider";
import { ThemeProvider } from "@/components/theme-provider";

/**
 * Client-side providers mounted once in the root layout.
 *
 * Order matters: `ThemeProvider` first so the class is reapplied before
 * paint; `QueryClientProvider` before `AuthProvider` (logout clears the
 * cache); `RealtimeProvider` inside auth (it opens the socket only when a
 * session exists). `AppHeader` sits inside all of them and every page gets
 * the header + `<main>` shell.
 *
 * The QueryClient lives in state so it is created once per browser session,
 * never per render. TanStack Query is the only allowed client-side
 * API-fetching path — see AGENTS.md > Code style.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
          },
        },
      }),
  );

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RealtimeProvider>
            <AppHeader />
            <main className="flex flex-1 flex-col">{children}</main>
          </RealtimeProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
