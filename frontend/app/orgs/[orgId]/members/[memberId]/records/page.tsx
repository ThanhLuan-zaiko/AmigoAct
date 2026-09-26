import type { Metadata } from "next";

import { RequireAuth } from "@/components/require-auth";

import { MemberRecordsView } from "./member-records-view";

export const metadata: Metadata = {
  title: "Thành tích thành viên",
};

export default async function MemberRecordsPage({
  params,
}: {
  params: Promise<{ orgId: string; memberId: string }>;
}) {
  const { orgId, memberId } = await params;
  return (
    <RequireAuth>
      <MemberRecordsView orgId={orgId} memberId={memberId} />
    </RequireAuth>
  );
}
