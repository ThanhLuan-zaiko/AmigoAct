import type { Metadata } from "next";
import { Suspense } from "react";

import { RequireAuth } from "@/components/require-auth";

import { CheckinView } from "./checkin-view";

export const metadata: Metadata = {
  title: "Điểm danh",
};

export default function CheckinPage() {
  return (
    <RequireAuth>
      {/*
        CheckinView calls useSearchParams (the QR lands on /checkin?a=&c=),
        which client-renders below the nearest Suspense boundary on a
        prerendered build — required or `next build` fails.
      */}
      <Suspense
        fallback={
          <output className="block px-4 py-16 text-center text-sm text-neutral-500 dark:text-neutral-400">
            Đang tải…
          </output>
        }
      >
        <CheckinView />
      </Suspense>
    </RequireAuth>
  );
}
