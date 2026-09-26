import type { Metadata } from "next";

import { RequireAuth } from "@/components/require-auth";

import { NewActivityView } from "./new-activity-view";

export const metadata: Metadata = {
  title: "Tạo hoạt động",
};

export default async function NewActivityPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  return (
    <RequireAuth>
      <NewActivityView orgId={orgId} />
    </RequireAuth>
  );
}
