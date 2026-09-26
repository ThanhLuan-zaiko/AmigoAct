"use client";

import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";

import { useAuth } from "@/components/auth-provider";

/**
 * Gate for authenticated pages. Wrap protected content in it:
 *
 *   <RequireAuth><DashboardView /></RequireAuth>
 *
 * While the session is being resolved it shows an honest loading state;
 * anonymous visitors are sent to `/login?next=<current path>` and nothing
 * protected is rendered. Children always render through for SSR/loading —
 * they stay behind the gate visually until authenticated.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "anonymous") {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [status, router, pathname]);

  if (status === "loading") {
    return (
      <output className="flex flex-1 items-center justify-center px-4 py-24 text-sm text-neutral-500 dark:text-neutral-400">
        Đang kiểm tra đăng nhập…
      </output>
    );
  }
  if (status === "anonymous") {
    return null;
  }
  return <>{children}</>;
}
