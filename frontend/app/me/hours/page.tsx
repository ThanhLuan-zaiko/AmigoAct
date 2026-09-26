import type { Metadata } from "next";

import { RequireAuth } from "@/components/require-auth";

import { HoursView } from "./hours-view";

export const metadata: Metadata = {
  title: "Giờ tình nguyện",
};

export default function HoursPage() {
  return (
    <RequireAuth>
      <HoursView />
    </RequireAuth>
  );
}
