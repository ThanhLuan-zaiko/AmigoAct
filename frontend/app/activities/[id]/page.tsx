import type { Metadata } from "next";

import { RequireAuth } from "@/components/require-auth";

import { ActivityView } from "./activity-view";

export const metadata: Metadata = {
  title: "Hoạt động",
};

export default async function ActivityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <RequireAuth>
      <ActivityView activityId={id} />
    </RequireAuth>
  );
}
