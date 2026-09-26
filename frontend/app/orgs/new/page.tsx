import type { Metadata } from "next";

import { RequireAuth } from "@/components/require-auth";

import { OrgForm } from "./org-form";

export const metadata: Metadata = {
  title: "Tạo tổ chức",
};

export default function NewOrgPage() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-10">
      <RequireAuth>
        <OrgForm />
      </RequireAuth>
    </div>
  );
}
