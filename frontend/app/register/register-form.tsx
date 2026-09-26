"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useId, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { apiFetch } from "@/lib/api";
import { describeApiError } from "@/lib/errors";
import type { AuthResponse } from "@/lib/types";

interface RegisterCredentials {
  full_name: string;
  email: string;
  password: string;
}

export function RegisterForm() {
  const router = useRouter();
  const { status, signIn } = useAuth();
  const fieldId = useId();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  // A signed-in session has no business on /register.
  useEffect(() => {
    if (status === "authenticated") {
      router.replace("/dashboard");
    }
  }, [status, router]);

  const register = useMutation({
    mutationFn: (credentials: RegisterCredentials) =>
      apiFetch<AuthResponse>("/api/auth/register", {
        method: "POST",
        body: credentials,
      }),
    onSuccess: (auth) => signIn(auth),
    onError: (mutationError: unknown) =>
      setError(describeApiError(mutationError)),
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password !== confirm) {
      setError("Mật khẩu nhập lại không khớp");
      return;
    }
    setError(null);
    register.mutate({
      full_name: fullName.trim(),
      email: email.trim(),
      password,
    });
  };

  // While status is "loading" the app has not hydrated yet — the SSR markup
  // ships this form with the submit disabled, so a pre-hydration click cannot
  // fall back to a native GET submit (which would leak credentials into the
  // URL/query string).
  const submitDisabled = status === "loading" || register.isPending;

  const inputClass =
    "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-neutral-500";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Tạo tài khoản</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Tạo tài khoản để tham gia các hoạt động của Đoàn – Hội.
        </p>
      </header>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${fieldId}-name`} className="text-sm font-medium">
            Họ và tên
          </label>
          <input
            id={`${fieldId}-name`}
            type="text"
            name="full_name"
            autoComplete="name"
            required
            maxLength={120}
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            className={inputClass}
          />
        </div>
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
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${fieldId}-confirm`} className="text-sm font-medium">
            Nhập lại mật khẩu
          </label>
          <input
            id={`${fieldId}-confirm`}
            type="password"
            name="confirm"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
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
          {register.isPending ? "Đang tạo tài khoản…" : "Tạo tài khoản"}
        </button>
      </form>

      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Đã có tài khoản?{" "}
        <Link
          href="/login"
          className="font-medium text-neutral-900 underline underline-offset-4 dark:text-neutral-100"
        >
          Đăng nhập
        </Link>
      </p>
    </div>
  );
}
