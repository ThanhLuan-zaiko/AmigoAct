"use client";

import Link from "next/link";
import { FiLogOut } from "react-icons/fi";

import { useAuth } from "@/components/auth-provider";
import { useSocketStatus } from "@/components/realtime-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import type { SocketStatus } from "@/lib/websocket";

const SOCKET_LABEL: Record<SocketStatus, string> = {
  open: "Đã kết nối",
  connecting: "Đang kết nối",
  closed: "Ngoại tuyến",
};

const SOCKET_DOT: Record<SocketStatus, string> = {
  open: "bg-emerald-500",
  connecting: "bg-amber-500",
  closed: "bg-neutral-400 dark:bg-neutral-600",
};

/**
 * Sticky top bar for every page (mounted by `Providers`).
 *
 * The session starts as `"loading"` on server and client alike, so the
 * right side shows only the theme toggle until the first effect resolves —
 * anonymous visitors then get login/register links, members get the
 * realtime status dot, their name and a logout button.
 */
export function AppHeader() {
  const { status, user, logout } = useAuth();
  const socketStatus = useSocketStatus();
  const authenticated = status === "authenticated";

  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-4 px-4 sm:px-6">
        <Link
          href={authenticated ? "/dashboard" : "/"}
          className="text-base font-semibold tracking-tight text-neutral-900 dark:text-neutral-50"
        >
          AmigoAct
        </Link>
        {authenticated && (
          <nav
            aria-label="Điều hướng chính"
            className="flex items-center gap-1"
          >
            <Link
              href="/dashboard"
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              Bảng tin
            </Link>
            <Link
              href="/me/hours"
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              Giờ tình nguyện
            </Link>
          </nav>
        )}
        <div className="ml-auto flex items-center gap-2">
          {authenticated && (
            <span
              className="flex items-center"
              title={SOCKET_LABEL[socketStatus]}
            >
              <span
                aria-hidden="true"
                className={`h-2 w-2 rounded-full ${SOCKET_DOT[socketStatus]}`}
              />
              <span className="sr-only">{SOCKET_LABEL[socketStatus]}</span>
            </span>
          )}
          <ThemeToggle />
          {authenticated ? (
            <>
              <span className="hidden max-w-40 truncate text-sm text-neutral-700 sm:inline dark:text-neutral-300">
                {user?.full_name}
              </span>
              <button
                type="button"
                onClick={logout}
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
              >
                <FiLogOut aria-hidden="true" className="h-4 w-4" />
                Đăng xuất
              </button>
            </>
          ) : status === "anonymous" ? (
            <>
              <Link
                href="/login"
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                Đăng nhập
              </Link>
              <Link
                href="/register"
                className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
              >
                Tạo tài khoản
              </Link>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}
