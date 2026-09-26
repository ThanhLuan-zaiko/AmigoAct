"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { FiCheck, FiCopy, FiPlus } from "react-icons/fi";

import { ActivityCard } from "@/components/activity-card";
import { useAuth } from "@/components/auth-provider";
import { EmptyState } from "@/components/empty-state";
import { ErrorBanner } from "@/components/error-banner";
import { apiFetch } from "@/lib/api";
import { isManagerRole, MEMBER_ROLE_LABELS, statusLabel } from "@/lib/labels";
import { qk } from "@/lib/query-keys";
import type {
  ActivityStatus,
  OrgActivitiesResponse,
  OrgDetailResponse,
} from "@/lib/types";

/** Activity status filter options shown to everyone. */
const PUBLIC_FILTERS: readonly (ActivityStatus | undefined)[] = [
  undefined,
  "published",
  "cancelled",
  "completed",
];

/** Copyable join-code chip with transient "Đã sao chép" feedback. */
function JoinCodeChip({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be unavailable (permissions/jsdom) — stay silent.
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      aria-label="Sao chép mã tham gia"
      className="inline-flex items-center gap-1.5 rounded-full border border-neutral-300 px-3 py-1 font-mono text-xs text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
    >
      {copied ? (
        <FiCheck aria-hidden="true" className="h-3.5 w-3.5" />
      ) : (
        <FiCopy aria-hidden="true" className="h-3.5 w-3.5" />
      )}
      {copied ? "Đã sao chép" : `Mã tham gia: ${code}`}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
        {label}
      </p>
    </div>
  );
}

export function OrgView({ orgId }: { orgId: string }) {
  const { token } = useAuth();
  const [statusFilter, setStatusFilter] = useState<ActivityStatus | undefined>(
    undefined,
  );

  const detail = useQuery({
    queryKey: qk.orgs(orgId),
    queryFn: ({ signal }) =>
      apiFetch<OrgDetailResponse>(`/api/orgs/${orgId}`, {
        token: token ?? undefined,
        signal,
      }),
    enabled: token !== null,
  });

  const manager =
    detail.data !== undefined && isManagerRole(detail.data.membership.role);

  const activities = useQuery({
    queryKey: qk.orgActivities(orgId, statusFilter),
    queryFn: ({ signal }) =>
      apiFetch<OrgActivitiesResponse>(
        `/api/orgs/${orgId}/activities${
          statusFilter === undefined ? "" : `?status=${statusFilter}`
        }`,
        { token: token ?? undefined, signal },
      ),
    enabled: token !== null && detail.isSuccess,
  });

  if (detail.isPending) {
    return (
      <output className="block px-4 py-16 text-center text-sm text-neutral-500 dark:text-neutral-400">
        Đang tải tổ chức…
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

  const { org, membership, stats } = detail.data;
  const filters = manager
    ? ([undefined, "draft", "published", "cancelled", "completed"] as const)
    : PUBLIC_FILTERS;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-10">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{org.name}</h1>
          <span className="rounded-full border border-neutral-300 px-2.5 py-0.5 text-xs font-medium text-neutral-700 dark:border-neutral-700 dark:text-neutral-300">
            {MEMBER_ROLE_LABELS[membership.role]}
          </span>
        </div>
        <JoinCodeChip code={org.code} />
        {org.description !== null && (
          <p className="text-sm whitespace-pre-line text-neutral-600 dark:text-neutral-400">
            {org.description}
          </p>
        )}
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Thành viên" value={stats.member_count} />
          <Stat label="Hoạt động" value={stats.activity_count} />
          <Stat label="Sắp diễn ra" value={stats.upcoming_count} />
        </div>
        {manager && (
          <nav
            aria-label="Quản lý tổ chức"
            className="flex flex-wrap gap-2 text-sm"
          >
            <Link
              href={`/orgs/${orgId}/activities/new`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
            >
              <FiPlus aria-hidden="true" className="h-4 w-4" />
              Tạo hoạt động
            </Link>
            <Link
              href={`/orgs/${orgId}/members`}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              Thành viên
            </Link>
            <Link
              href={`/orgs/${orgId}/reports`}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              Báo cáo
            </Link>
          </nav>
        )}
      </header>

      <section aria-labelledby="org-activities" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="org-activities" className="text-lg font-semibold">
            Hoạt động
          </h2>
          <div className="ml-auto flex flex-wrap gap-1">
            {filters.map((value) => (
              <button
                key={value ?? "all"}
                type="button"
                onClick={() => setStatusFilter(value)}
                aria-pressed={statusFilter === value}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  statusFilter === value
                    ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                    : "border-neutral-300 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
                }`}
              >
                {value === undefined ? "Tất cả" : statusLabel(value)}
              </button>
            ))}
          </div>
        </div>

        {activities.isPending && (
          <output className="block text-sm text-neutral-500 dark:text-neutral-400">
            Đang tải hoạt động…
          </output>
        )}
        {activities.isError && <ErrorBanner error={activities.error} />}
        {activities.isSuccess &&
          (activities.data.activities.length === 0 ? (
            <EmptyState
              icon={FiPlus}
              title="Chưa có hoạt động nào"
              hint={
                manager
                  ? "Tạo hoạt động đầu tiên để thành viên đăng ký."
                  : "Chưa có hoạt động nào được công bố."
              }
              action={
                manager
                  ? {
                      href: `/orgs/${orgId}/activities/new`,
                      label: "Tạo hoạt động",
                    }
                  : undefined
              }
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {activities.data.activities.map((item) => (
                <ActivityCard
                  key={item.activity.id}
                  activity={item.activity}
                  registered={item.registered}
                  checkedIn={item.checked_in}
                />
              ))}
            </ul>
          ))}
      </section>
    </div>
  );
}
