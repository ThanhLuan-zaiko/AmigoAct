"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { useAuth } from "@/components/auth-provider";
import { ErrorBanner } from "@/components/error-banner";
import { StatusChip } from "@/components/status-chip";
import { apiFetch } from "@/lib/api";
import { checkinOpensAt } from "@/lib/checkin";
import { formatDateTime, formatHours } from "@/lib/format";
import { isManagerRole } from "@/lib/labels";
import { qk } from "@/lib/query-keys";
import type { ActivityDetailResponse, OrgDetailResponse } from "@/lib/types";

import { RegistrationPanel } from "./registration-panel";

/**
 * Member-facing activity screen: info panel + the caller's registration
 * state machine (see `registration-panel.tsx`). Managers additionally get
 * the "Quản lý" link. Live updates arrive via WS invalidation of
 * `qk.activity(id)`.
 */
export function ActivityView({ activityId }: { activityId: string }) {
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
  const manager =
    org.data !== undefined && isManagerRole(org.data.membership.role);

  if (detail.isPending) {
    return (
      <output className="block px-4 py-16 text-center text-sm text-neutral-500 dark:text-neutral-400">
        Đang tải hoạt động…
      </output>
    );
  }
  if (detail.isError) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16">
        <ErrorBanner error={detail.error} />
      </div>
    );
  }

  const { activity, registered, checked_in: checkedIn } = detail.data;
  const registration = detail.data.my_registration;
  const showPanel = activity.status === "published" || registration !== null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">
            {activity.title}
          </h1>
          <StatusChip status={activity.status} />
        </div>
        {manager && (
          <Link
            href={`/activities/${activityId}/manage`}
            className="self-start rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            Quản lý →
          </Link>
        )}
      </header>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <dl className="flex flex-col gap-2 text-sm text-neutral-700 dark:text-neutral-300">
          <div className="flex gap-2">
            <dt className="w-32 shrink-0 text-neutral-500 dark:text-neutral-400">
              Thời gian
            </dt>
            <dd>
              {formatDateTime(activity.starts_at)} –{" "}
              {formatDateTime(activity.ends_at)}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-32 shrink-0 text-neutral-500 dark:text-neutral-400">
              Điểm danh
            </dt>
            <dd>từ {formatDateTime(checkinOpensAt(activity.starts_at))}</dd>
          </div>
          {activity.location !== null && (
            <div className="flex gap-2">
              <dt className="w-32 shrink-0 text-neutral-500 dark:text-neutral-400">
                Địa điểm
              </dt>
              <dd>{activity.location}</dd>
            </div>
          )}
          <div className="flex gap-2">
            <dt className="w-32 shrink-0 text-neutral-500 dark:text-neutral-400">
              Sức chứa
            </dt>
            <dd>
              {activity.capacity === null
                ? "Không giới hạn"
                : `${activity.capacity} người`}{" "}
              · Đăng ký {registered} · Điểm danh {checkedIn}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-32 shrink-0 text-neutral-500 dark:text-neutral-400">
              Thành tích
            </dt>
            <dd>
              {formatHours(Number(activity.hours))} giờ ·{" "}
              {formatHours(Number(activity.points))} điểm
            </dd>
          </div>
        </dl>
        {activity.description !== null && (
          <p className="mt-4 border-t border-neutral-200 pt-4 text-sm whitespace-pre-line text-neutral-700 dark:border-neutral-800 dark:text-neutral-300">
            {activity.description}
          </p>
        )}
      </section>

      {showPanel && (
        <RegistrationPanel
          activityId={activityId}
          orgId={activity.org_id}
          status={activity.status}
          registration={registration}
        />
      )}
    </div>
  );
}
