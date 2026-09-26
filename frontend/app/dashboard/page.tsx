import type { Metadata } from "next";

import { RequireAuth } from "@/components/require-auth";

import { DashboardView } from "./dashboard-view";

export const metadata: Metadata = {
  title: "Bảng tin",
};

export default function DashboardPage() {
  return (
    <RequireAuth>
      <DashboardView />
    </RequireAuth>
  );
}
