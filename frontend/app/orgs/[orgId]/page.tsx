import type { Metadata } from "next";

import { RequireAuth } from "@/components/require-auth";

import { OrgView } from "./org-view";

export const metadata: Metadata = {
  title: "Tổ chức",
};

export default async function OrgPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  return (
    <RequireAuth>
      <OrgView orgId={orgId} />
    </RequireAuth>
  );
}
