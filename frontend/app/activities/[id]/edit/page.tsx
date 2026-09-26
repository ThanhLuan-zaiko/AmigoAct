import type { Metadata } from "next";

import { RequireAuth } from "@/components/require-auth";

import { EditActivityView } from "./edit-activity-view";

export const metadata: Metadata = {
  title: "Chỉnh sửa hoạt động",
};

export default async function EditActivityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <RequireAuth>
      <EditActivityView activityId={id} />
    </RequireAuth>
  );
}
