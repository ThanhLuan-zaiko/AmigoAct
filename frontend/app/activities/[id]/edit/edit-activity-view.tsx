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
import type { ActivityDetailResponse, OrgDetailResponse } from "@/lib/types";

/**
 * Edit-activity screen — managers only, and only while the activity is not
 * in a terminal state (cancelled/completed), matching the PATCH contract.
 * The form prefills from `isoToDatetimeLocal`.
 */
export function EditActivityView({ activityId }: { activityId: string }) {
  const { token } = useAuth();
  const detail = useQuery({
    queryKey: qk.activity(activityId),
    queryFn: ({ signal }) =>
      apiFetch<ActivityDetailResponse>(`/api/activities/${activityId}`, {
        token: token ?? undefined,
        signal,
      }),
    enabled: token !== null,
  });

  const orgId = detail.data?.activity.org_id;
  const org = useQuery({
    queryKey: qk.orgs(orgId ?? ""),
    queryFn: ({ signal }) =>
      apiFetch<OrgDetailResponse>(`/api/orgs/${orgId}`, {
        token: token ?? undefined,
        signal,
      }),
    enabled: token !== null && orgId !== undefined,
  });

  if (detail.isPending || (detail.isSuccess && org.isPending)) {
    return (
      <output className="block px-4 py-16 text-center text-sm text-neutral-500 dark:text-neutral-400">
        Đang tải hoạt động…
      </output>
    );
  }
  if (detail.isError || org.isError) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-16">
        <ErrorBanner error={detail.error ?? org.error} />
      </div>
    );
  }
  if (!detail.isSuccess || !org.isSuccess) {
    return null;
  }

  const activity = detail.data.activity;
  const wrap = (children: React.ReactNode) => (
    <div className="mx-auto w-full max-w-md px-4 py-16">{children}</div>
  );

  if (!isManagerRole(org.data.membership.role)) {
    return wrap(
      <EmptyState
        icon={FiLock}
        title="Cần quyền quản lý"
        hint="Chỉ ban chấp hành hoặc quản trị viên mới sửa được hoạt động."
        action={{
          href: `/activities/${activityId}`,
          label: "Về trang hoạt động",
        }}
      />,
    );
  }
  if (activity.status === "cancelled" || activity.status === "completed") {
    return wrap(
      <EmptyState
        icon={FiLock}
        title="Không thể chỉnh sửa"
        hint="Hoạt động đã kết thúc hoặc đã bị hủy."
        action={{
          href: `/activities/${activityId}`,
          label: "Về trang hoạt động",
        }}
      />,
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-10">
      <header className="mb-6 flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">
          Chỉnh sửa hoạt động
        </h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {activity.title}
        </p>
      </header>
      <ActivityForm activity={activity} />
    </div>
  );
}
