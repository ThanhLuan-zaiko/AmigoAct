"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { FiAward, FiDownload } from "react-icons/fi";

import { useAuth } from "@/components/auth-provider";
import { EmptyState } from "@/components/empty-state";
import { ErrorBanner } from "@/components/error-banner";
import { apiFetch, apiFetchBlob } from "@/lib/api";
import { certificateFilename, downloadBlob } from "@/lib/download";
import { describeApiError } from "@/lib/errors";
import { formatDay, formatHours } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import type { MyRecordItem, MyRecords, VolunteerRecord } from "@/lib/types";

/** One stat card in the totals strip. */
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
 * `/me/hours` — the member's volunteer record book.
 *
 * Reads `GET /api/me/records` (totals + per-org breakdown + every record)
 * and offers a per-row PDF certificate download via `apiFetchBlob` +
 * `downloadBlob`. Download failures surface inline under the row.
 */
export function HoursView() {
  const { token } = useAuth();
  const [certErrors, setCertErrors] = useState<Record<string, string>>({});

  const mine = useQuery({
    queryKey: qk.meRecords,
    queryFn: ({ signal }) =>
      apiFetch<MyRecords>("/api/me/records", {
        token: token ?? undefined,
        signal,
      }),
    enabled: token !== null,
  });

  const certificate = useMutation({
    mutationFn: (record: VolunteerRecord) =>
      apiFetchBlob(`/api/records/${record.id}/certificate`, {
        token: token ?? undefined,
      }),
    onSuccess: (blob, record) => {
      setCertErrors((prev) => {
        const next = { ...prev };
        delete next[record.id];
        return next;
      });
      downloadBlob(blob, certificateFilename(record.id));
    },
    onError: (error, record) => {
      setCertErrors((prev) => ({
        ...prev,
        [record.id]: describeApiError(error),
      }));
    },
  });

  if (mine.isPending) {
    return (
      <output className="block px-4 py-16 text-center text-sm text-neutral-500 dark:text-neutral-400">
        Đang tải thành tích…
      </output>
    );
  }
  if (mine.isError) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16">
        <ErrorBanner error={mine.error} />
      </div>
    );
  }

  const { totals, by_org: byOrg, records } = mine.data;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Giờ tình nguyện</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Tổng hợp giờ, điểm và thành tích đã được ghi nhận của bạn.
        </p>
      </header>

      <section
        aria-label="Tổng quan"
        className="grid grid-cols-3 gap-3 max-sm:grid-cols-1"
      >
        <Stat
          label="Tổng giờ tình nguyện"
          value={formatHours(Number(totals.hours))}
        />
        <Stat label="Tổng điểm" value={formatHours(Number(totals.points))} />
        <Stat label="Số thành tích" value={String(records.length)} />
      </section>

      {byOrg.length > 0 && (
        <section aria-label="Theo tổ chức" className="flex flex-wrap gap-2">
          {byOrg.map((bucket) => (
            <span
              key={bucket.org.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-neutral-300 px-3 py-1 text-xs font-medium text-neutral-700 dark:border-neutral-700 dark:text-neutral-300"
            >
              {bucket.org.name}
              <span className="tabular-nums text-neutral-500 dark:text-neutral-400">
                {formatHours(Number(bucket.hours))} giờ
              </span>
            </span>
          ))}
        </section>
      )}

      {records.length === 0 ? (
        <EmptyState
          icon={FiAward}
          title="Bạn chưa có thành tích nào"
          hint="Tham gia hoạt động và điểm danh để được ghi nhận giờ tình nguyện."
          action={{ href: "/dashboard", label: "Xem hoạt động" }}
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                <th className="px-4 py-2 font-medium">Ngày ghi nhận</th>
                <th className="px-4 py-2 font-medium">Thành tích</th>
                <th className="px-4 py-2 font-medium">Giờ</th>
                <th className="px-4 py-2 font-medium">Điểm</th>
                <th className="px-4 py-2 font-medium">Chứng nhận</th>
              </tr>
            </thead>
            <tbody>
              {records.map((item: MyRecordItem) => {
                const { record, activity, org } = item;
                const downloading =
                  certificate.isPending &&
                  certificate.variables?.id === record.id;
                return (
                  <tr
                    key={record.id}
                    className="border-b border-neutral-100 align-top last:border-0 dark:border-neutral-800"
                  >
                    <td className="px-4 py-3 whitespace-nowrap tabular-nums text-neutral-600 dark:text-neutral-400">
                      {formatDay(record.awarded_on)}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-neutral-900 dark:text-neutral-100">
                        {record.title}
                      </p>
                      {activity !== null && (
                        <Link
                          href={`/activities/${activity.id}`}
                          className="text-xs text-neutral-500 underline-offset-4 hover:underline dark:text-neutral-400"
                        >
                          {activity.title}
                        </Link>
                      )}
                      <p className="text-xs text-neutral-500 dark:text-neutral-400">
                        {org.name}
                      </p>
                      {certErrors[record.id] !== undefined && (
                        <p
                          role="alert"
                          className="mt-1 text-xs text-red-600 dark:text-red-400"
                        >
                          {certErrors[record.id]}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {record.hours === null
                        ? "—"
                        : formatHours(Number(record.hours))}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {formatHours(Number(record.points))}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        disabled={downloading}
                        onClick={() => certificate.mutate(record)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                      >
                        <FiDownload
                          aria-hidden="true"
                          className="h-3.5 w-3.5"
                        />
                        {downloading ? "Đang tải…" : "Tải chứng nhận"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
