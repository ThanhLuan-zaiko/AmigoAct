import type { Metadata } from "next";

import { RequireAuth } from "@/components/require-auth";

import { MyRegistrationsView } from "./my-registrations-view";

export const metadata: Metadata = {
  title: "Đăng ký của tôi",
};

export default function MyRegistrationsPage() {
  return (
    <RequireAuth>
      <MyRegistrationsView />
    </RequireAuth>
  );
}
