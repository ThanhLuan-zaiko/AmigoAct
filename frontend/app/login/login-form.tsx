"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useId, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { apiFetch } from "@/lib/api";
import { describeApiError } from "@/lib/errors";
import type { AuthResponse } from "@/lib/types";

/**
 * Only app-internal paths may be redirect targets — anything else (missing,
 * absolute URL, protocol-relative) falls back to the dashboard so a crafted
 * `?next=` cannot bounce the user off-site.
 */
function sanitizeNext(value: string | null): string {
  if (value === null || !value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard";
  }
  return value;
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status, signIn } = useAuth();
  const fieldId = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const next = sanitizeNext(searchParams.get("next"));

  // Already signed in — or just signed in — should never sit on /login.
  useEffect(() => {
    if (status === "authenticated") {
      router.replace(next);
    }
  }, [status, router, next]);

  const login = useMutation({
    mutationFn: (credentials: { email: string; password: string }) =>
      apiFetch<AuthResponse>("/api/auth/login", {
        method: "POST",
        body: credentials,
      }),
    onSuccess: (auth) => signIn(auth),
    onError: (mutationError: unknown) =>
      setError(describeApiError(mutationError)),
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    login.mutate({ email: email.trim(), password });
  };

  // While status is "loading" the app has not hydrated yet — the SSR markup
  // ships this form with the submit disabled, so a pre-hydration click cannot
  // fall back to a native GET submit (which would leak credentials into the
  // URL/query string).
  const submitDisabled = status === "loading" || login.isPending;

  const inputClass =
    "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-neutral-500";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Đăng nhập</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Đăng nhập để quản lý hoạt động tình nguyện của bạn.
        </p>
      </header>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${fieldId}-email`} className="text-sm font-medium">
            Email
          </label>
          <input
            id={`${fieldId}-email`}
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`${fieldId}-password`}
            className="text-sm font-medium"
          >
            Mật khẩu
          </label>
          <input
            id={`${fieldId}-password`}
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={inputClass}
          />
        </div>

        {error !== null && (
          <p
            role="alert"
            className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitDisabled}
          className="rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {login.isPending ? "Đang đăng nhập…" : "Đăng nhập"}
        </button>
      </form>

      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Chưa có tài khoản?{" "}
        <Link
          href="/register"
          className="font-medium text-neutral-900 underline underline-offset-4 dark:text-neutral-100"
        >
          Tạo tài khoản
        </Link>
      </p>
    </div>
  );
}
