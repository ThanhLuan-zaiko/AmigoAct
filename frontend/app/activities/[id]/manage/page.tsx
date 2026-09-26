import type { Metadata } from "next";

import { RequireAuth } from "@/components/require-auth";

import { ManageView } from "./manage-view";

export const metadata: Metadata = {
  title: "Quản lý hoạt động",
};

export default async function ManageActivityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <RequireAuth>
      <ManageView activityId={id} />
    </RequireAuth>
  );
}
