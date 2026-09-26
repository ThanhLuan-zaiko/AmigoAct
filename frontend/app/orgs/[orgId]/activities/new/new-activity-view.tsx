"use client";

import { useQuery } from "@tanstack/react-query";
import { FiLock } from "react-icons/fi";

import { ActivityForm } from "@/components/activity-form";
import { useAuth } from "@/components/auth-provider";
import { EmptyState } from "@/components/empty-state";
import { ErrorBanner } from "@/components/error-banner";
import { apiFetch } from "@/lib/api";
import { isManagerRole } from "@/lib/labels";
import { qk } from "@/lib/query-keys";
import type { OrgDetailResponse } from "@/lib/types";

/**
 * Create-activity screen. Only managers may see the form — membership role
 * comes from the org detail query (the server re-checks on POST anyway).
 */
export function NewActivityView({ orgId }: { orgId: string }) {
  const { token } = useAuth();
  const detail = useQuery({
    queryKey: qk.orgs(orgId),
    queryFn: ({ signal }) =>
      apiFetch<OrgDetailResponse>(`/api/orgs/${orgId}`, {
        token: token ?? undefined,
        signal,
      }),
    enabled: token !== null,
  });

  if (detail.isPending) {
    return (
      <output className="block px-4 py-16 text-center text-sm text-neutral-500 dark:text-neutral-400">
        Đang tải…
      </output>
    );
  }
  if (detail.isError) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-16">
        <ErrorBanner error={detail.error} />
      </div>
    );
  }
  if (!isManagerRole(detail.data.membership.role)) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-16">
        <EmptyState
          icon={FiLock}
          title="Cần quyền quản lý"
          hint="Chỉ ban chấp hành hoặc quản trị viên mới tạo được hoạt động."
          action={{ href: `/orgs/${orgId}`, label: "Về trang tổ chức" }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-10">
      <header className="mb-6 flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Tạo hoạt động</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Hoạt động mới thuộc {detail.data.org.name} và bắt đầu ở trạng thái bản
          nháp.
        </p>
      </header>
      <ActivityForm orgId={orgId} />
    </div>
  );
}
