import type { Metadata } from "next";

import { RequireAuth } from "@/components/require-auth";

import { JoinForm } from "./join-form";

export const metadata: Metadata = {
  title: "Tham gia tổ chức",
};

export default function JoinOrgPage() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-10">
      <RequireAuth>
        <JoinForm />
      </RequireAuth>
    </div>
  );
}
