"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { FiLock } from "react-icons/fi";

import { useAuth } from "@/components/auth-provider";
import { EmptyState } from "@/components/empty-state";
import { ErrorBanner } from "@/components/error-banner";
import { InputField } from "@/components/field";
import { apiFetch } from "@/lib/api";
import { formatHours, formatPercent } from "@/lib/format";
import { isManagerRole } from "@/lib/labels";
import { qk, type ReportParams } from "@/lib/query-keys";
import type {
  ActivitiesReport,
  OrgDetailResponse,
  ReportsOverview,
} from "@/lib/types";

import {
  ActivityReportTable,
  FacultyTable,
  MonthlyTable,
  TopVolunteers,
} from "./reports-tables";

/** One stat card in the overview strip. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
        {label}
      </p>
    </div>
  );
}

/**
 * `/orgs/[orgId]/reports` — manager report dashboard.
 *
 * `from`/`to` date inputs feed both queries through the query key, so each
 * change re-fetches automatically. Zero totals render as zeros; empty
 * sections say "Chưa có dữ liệu trong khoảng này".
 */
export function ReportsView({ orgId }: { orgId: string }) {
  const { token } = useAuth();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  // Seed from `?from=&to=` so a report link is shareable.
  const [from, setFrom] = useState(searchParams.get("from") ?? "");
  const [to, setTo] = useState(searchParams.get("to") ?? "");

  /** Update the range state, the query key and the URL together. */
  const applyRange = (nextFrom: string, nextTo: string) => {
    setFrom(nextFrom);
    setTo(nextTo);
    const query = new URLSearchParams();
    if (nextFrom !== "") {
      query.set("from", nextFrom);
    }
    if (nextTo !== "") {
      query.set("to", nextTo);
    }
    const url = query.size === 0 ? pathname : `${pathname}?${query}`;
    router.replace(url, { scroll: false });
  };

  const org = useQuery({
    queryKey: qk.orgs(orgId),
    queryFn: ({ signal }) =>
      apiFetch<OrgDetailResponse>(`/api/orgs/${orgId}`, {
        token: token ?? undefined,
        signal,
      }),
    enabled: token !== null,
  });

  const manager = org.isSuccess && isManagerRole(org.data.membership.role);

  const params: ReportParams = {};
  const search = new URLSearchParams();
  if (from !== "") {
    params.from = from;
    search.set("from", from);
  }
  if (to !== "") {
    params.to = to;
    search.set("to", to);
  }
  const scopedParams = Object.keys(params).length > 0 ? params : undefined;
  const suffix = search.size === 0 ? "" : `?${search}`;

  const overview = useQuery({
    queryKey: qk.reports(orgId, "overview", scopedParams),
    queryFn: ({ signal }) =>
      apiFetch<ReportsOverview>(
        `/api/orgs/${orgId}/reports/overview${suffix}`,
        { token: token ?? undefined, signal },
      ),
    enabled: token !== null && manager,
  });

  const activities = useQuery({
    queryKey: qk.reports(orgId, "activities", scopedParams),
    queryFn: ({ signal }) =>
      apiFetch<ActivitiesReport>(
        `/api/orgs/${orgId}/reports/activities${suffix}`,
        { token: token ?? undefined, signal },
      ),
    enabled: token !== null && manager,
  });

  if (org.isPending || (manager && overview.isPending)) {
    return (
      <output className="block px-4 py-16 text-center text-sm text-neutral-500 dark:text-neutral-400">
        Đang tải báo cáo…
      </output>
    );
  }
  if (org.isError || overview.isError || activities.isError) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16">
        <ErrorBanner error={org.error ?? overview.error ?? activities.error} />
      </div>
    );
  }
  if (!org.isSuccess) {
    return null;
  }

  if (!manager) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-16">
        <EmptyState
          icon={FiLock}
          title="Cần quyền quản lý"
          hint="Chỉ ban chấp hành hoặc quản trị viên mới xem được báo cáo."
          action={{ href: `/orgs/${orgId}`, label: "Về trang tổ chức" }}
        />
      </div>
    );
  }

  if (!overview.isSuccess) {
    return null;
  }

  const totals = overview.data.totals;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Báo cáo</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Tổng quan hoạt động và thành tích của {org.data.org.name}.
        </p>
        <nav
          aria-label="Quản lý tổ chức"
          className="flex flex-wrap gap-2 text-sm"
        >
          <Link
            href={`/orgs/${orgId}`}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            Trang tổ chức
          </Link>
          <Link
            href={`/orgs/${orgId}/members`}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            Thành viên
          </Link>
        </nav>
      </header>

      <section
        aria-label="Khoảng thời gian"
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
      >
        <div className="w-40">
          <InputField
            label="Từ ngày"
            type="date"
            name="from"
            value={from}
            onChange={(event) => applyRange(event.target.value, to)}
          />
        </div>
        <div className="w-40">
          <InputField
            label="Đến ngày"
            type="date"
            name="to"
            value={to}
            onChange={(event) => applyRange(from, event.target.value)}
          />
        </div>
        {(from !== "" || to !== "") && (
          <button
            type="button"
            onClick={() => applyRange("", "")}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            Xóa lọc
          </button>
        )}
      </section>

      <section
        aria-label="Tổng quan"
        className="grid grid-cols-2 gap-3 sm:grid-cols-4"
      >
        <Stat label="Hoạt động" value={String(totals.activities)} />
        <Stat label="Đã hoàn thành" value={String(totals.completed)} />
        <Stat label="Lượt đăng ký" value={String(totals.registrations)} />
        <Stat label="Điểm danh" value={String(totals.checked_in)} />
        <Stat
          label="Tỷ lệ điểm danh"
          value={formatPercent(Number(totals.checkin_rate))}
        />
        <Stat
          label="Tổng giờ"
          value={formatHours(Number(totals.total_hours))}
        />
        <Stat
          label="Tổng điểm"
          value={formatHours(Number(totals.total_points))}
        />
      </section>

      <MonthlyTable rows={overview.data.monthly} />
      <FacultyTable rows={overview.data.by_faculty} />
      <TopVolunteers rows={overview.data.top_volunteers} />
      {activities.isSuccess && (
        <ActivityReportTable rows={activities.data.activities} />
      )}
    </div>
  );
}
