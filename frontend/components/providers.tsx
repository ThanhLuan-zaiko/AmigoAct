"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

/**
 * Client-side providers mounted once in the root layout.
 *
 * TanStack Query is the only allowed client-side API-fetching path — see
 * AGENTS.md > Code style. The QueryClient lives in state so it is created
 * once per browser session, never per render.
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
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
