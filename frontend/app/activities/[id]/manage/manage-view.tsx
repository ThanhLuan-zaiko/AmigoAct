"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { FiLock } from "react-icons/fi";

import { useAuth } from "@/components/auth-provider";
import { EmptyState } from "@/components/empty-state";
import { ErrorBanner } from "@/components/error-banner";
import { LifecycleBar } from "@/components/lifecycle-bar";
import { QrPanel } from "@/components/qr-panel";
import { RegistrationsTable } from "@/components/registrations-table";
import { StatusChip } from "@/components/status-chip";
import { apiFetch } from "@/lib/api";
import { isManagerRole } from "@/lib/labels";
import { qk } from "@/lib/query-keys";
import type {
  ActivityDetailResponse,
  OrgDetailResponse,
  RegistrationsResponse,
} from "@/lib/types";

/**
 * Manager console for one activity: lifecycle transitions, the QR/check-in
 * code panel and the registrations table. The role gate reads membership
 * from the org detail; the live counters come from the activity detail +
 * approved-registrations queries and refresh over WS.
 */
export function ManageView({ activityId }: { activityId: string }) {
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

  const approved = useQuery({
    queryKey: qk.activityRegs(activityId, "approved"),
    queryFn: ({ signal }) =>
      apiFetch<RegistrationsResponse>(
        `/api/activities/${activityId}/registrations?status=approved`,
        { token: token ?? undefined, signal },
      ),
    enabled:
      token !== null &&
      detail.isSuccess &&
      org.isSuccess &&
      isManagerRole(org.data.membership.role),
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
      <div className="mx-auto w-full max-w-3xl px-4 py-16">
        <ErrorBanner error={detail.error ?? org.error} />
      </div>
    );
  }
  if (!detail.isSuccess || !org.isSuccess) {
    return null;
  }

  if (!isManagerRole(org.data.membership.role)) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-16">
        <EmptyState
          icon={FiLock}
          title="Cần quyền quản lý"
          hint="Chỉ ban chấp hành hoặc quản trị viên mới quản lý được hoạt động."
          action={{
            href: `/activities/${activityId}`,
            label: "Về trang hoạt động",
          }}
        />
      </div>
    );
  }

  const { activity, checked_in: checkedIn } = detail.data;
  const approvedCount = approved.data?.registrations.length ?? 0;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">
            {activity.title}
          </h1>
          <StatusChip status={activity.status} />
        </div>
        <nav aria-label="Quản lý" className="flex flex-wrap gap-2 text-sm">
          <Link
            href={`/activities/${activityId}`}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            Trang hoạt động
          </Link>
          {(activity.status === "draft" || activity.status === "published") && (
            <Link
              href={`/activities/${activityId}/edit`}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              Chỉnh sửa
            </Link>
          )}
        </nav>
      </header>

      <LifecycleBar activity={activity} />

      <QrPanel
        activityId={activityId}
        status={activity.status}
        checkinCode={detail.data.checkin_code}
        approved={approvedCount}
        checkedIn={checkedIn}
      />

      <RegistrationsTable activityId={activityId} />
    </div>
  );
}
