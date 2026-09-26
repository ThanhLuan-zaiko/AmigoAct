import type { Metadata } from "next";
import { Suspense } from "react";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Đăng nhập",
};

export default function LoginPage() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16">
      {/*
        LoginForm calls useSearchParams (for `next`), which client-renders it
        below the nearest Suspense boundary on a prerendered build — required
        or `next build` fails.
      */}
      <Suspense
        fallback={
          <output className="block text-sm text-neutral-500 dark:text-neutral-400">
            Đang tải…
          </output>
        }
      >
        <LoginForm />
      </Suspense>
    </div>
  );
}
