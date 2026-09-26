import type { Metadata } from "next";

import { RequireAuth } from "@/components/require-auth";

import { MembersView } from "./members-view";

export const metadata: Metadata = {
  title: "Thành viên",
};

export default async function MembersPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  return (
    <RequireAuth>
      <MembersView orgId={orgId} />
    </RequireAuth>
  );
}
