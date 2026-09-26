import type { Metadata } from "next";
import { Suspense } from "react";

import { RequireAuth } from "@/components/require-auth";

import { ReportsView } from "./reports-view";

export const metadata: Metadata = {
  title: "Báo cáo",
};

export default async function ReportsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  return (
    <RequireAuth>
      {/*
        ReportsView calls useSearchParams (shareable ?from=&to= range),
        which client-renders below the nearest Suspense boundary on a
        prerendered build — required or `next build` fails.
      */}
      <Suspense
        fallback={
          <output className="block px-4 py-16 text-center text-sm text-neutral-500 dark:text-neutral-400">
            Đang tải báo cáo…
          </output>
        }
      >
        <ReportsView orgId={orgId} />
      </Suspense>
    </RequireAuth>
  );
}
