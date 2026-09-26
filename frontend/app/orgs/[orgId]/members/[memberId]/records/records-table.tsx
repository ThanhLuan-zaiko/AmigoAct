"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { FiAward, FiDownload } from "react-icons/fi";

import { useAuth } from "@/components/auth-provider";
import { ConfirmAction } from "@/components/confirm-action";
import { EmptyState } from "@/components/empty-state";
import { ErrorBanner } from "@/components/error-banner";
import { apiFetch, apiFetchBlob } from "@/lib/api";
import { certificateFilename, downloadBlob } from "@/lib/download";
import { describeApiError } from "@/lib/errors";
import { formatDay, formatHours } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import type { VolunteerRecord } from "@/lib/types";

import { RecordForm, type RecordFormValues } from "./record-form";

const ACTION_BUTTON =
  "rounded-lg border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800";

/**
 * The member's records table with per-row actions: inline edit
 * (`PATCH /api/records/{id}`), confirmed delete (`DELETE`, 204) and the
 * PDF certificate download. Every mutation refreshes the member-records
 * prefix, the roster totals and the org reports.
 */
export function RecordsTable({
  orgId,
  records,
}: {
  orgId: string;
  records: VolunteerRecord[];
}) {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [certErrors, setCertErrors] = useState<Record<string, string>>({});

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: qk.memberRecords(orgId),
    });
    void queryClient.invalidateQueries({ queryKey: qk.orgMembers(orgId) });
    void queryClient.invalidateQueries({ queryKey: qk.reports(orgId) });
    void queryClient.invalidateQueries({ queryKey: qk.meRecords });
  };

  const update = useMutation({
    mutationFn: ({
      recordId,
      body,
    }: {
      recordId: string;
      body: RecordFormValues;
    }) =>
      apiFetch<{ record: VolunteerRecord }>(`/api/records/${recordId}`, {
        method: "PATCH",
        body,
        token: token ?? undefined,
      }),
    onSuccess: () => {
      setError(null);
      setEditingId(null);
      invalidate();
    },
    onError: setError,
  });

  const remove = useMutation({
    mutationFn: (recordId: string) =>
      apiFetch(`/api/records/${recordId}`, {
        method: "DELETE",
        token: token ?? undefined,
      }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: setError,
  });

  const certificate = useMutation({
    mutationFn: (recordId: string) =>
      apiFetchBlob(`/api/records/${recordId}/certificate`, {
        token: token ?? undefined,
      }),
    onSuccess: (blob, recordId) => {
      setCertErrors((prev) => {
        const next = { ...prev };
        delete next[recordId];
        return next;
      });
      downloadBlob(blob, certificateFilename(recordId));
    },
    onError: (error, recordId) => {
      setCertErrors((prev) => ({
        ...prev,
        [recordId]: describeApiError(error),
      }));
    },
  });

  const busy = update.isPending || remove.isPending;

  if (records.length === 0) {
    return (
      <EmptyState
        icon={FiAward}
        title="Chưa có thành tích"
        hint="Ghi nhận thành tích đầu tiên cho thành viên này."
      />
    );
  }

  return (
    <section
      aria-label="Danh sách thành tích"
      className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <ErrorBanner error={error} />
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
              <th className="py-2 pr-4 font-medium">Ngày</th>
              <th className="py-2 pr-4 font-medium">Thành tích</th>
              <th className="py-2 pr-4 font-medium">Giờ</th>
              <th className="py-2 pr-4 font-medium">Điểm</th>
              <th className="py-2 font-medium">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => {
              const downloading =
                certificate.isPending && certificate.variables === record.id;
              return (
                <tr
                  key={record.id}
                  className="border-b border-neutral-100 align-top last:border-0 dark:border-neutral-800"
                >
                  <td className="py-3 pr-4 whitespace-nowrap tabular-nums text-neutral-600 dark:text-neutral-400">
                    {formatDay(record.awarded_on)}
                  </td>
                  <td className="py-3 pr-4">
                    <p className="font-medium text-neutral-900 dark:text-neutral-100">
                      {record.title}
                    </p>
                    {record.activity_id !== null && (
                      <Link
                        href={`/activities/${record.activity_id}`}
                        className="text-xs text-neutral-500 underline-offset-4 hover:underline dark:text-neutral-400"
                      >
                        Xem hoạt động
                      </Link>
                    )}
                    {record.note !== null && (
                      <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                        {record.note}
                      </p>
                    )}
                    {record.evidence_url !== null && (
                      <a
                        href={record.evidence_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-sky-700 underline-offset-4 hover:underline dark:text-sky-300"
                      >
                        Minh chứng
                      </a>
                    )}
                    {certErrors[record.id] !== undefined && (
                      <p
                        role="alert"
                        className="mt-1 text-xs text-red-600 dark:text-red-400"
                      >
                        {certErrors[record.id]}
                      </p>
                    )}
                  </td>
                  <td className="py-3 pr-4 tabular-nums">
                    {record.hours === null
                      ? "—"
                      : formatHours(Number(record.hours))}
                  </td>
                  <td className="py-3 pr-4 tabular-nums">
                    {formatHours(Number(record.points))}
                  </td>
                  <td className="py-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          setEditingId((id) =>
                            id === record.id ? null : record.id,
                          )
                        }
                        className={ACTION_BUTTON}
                      >
                        Sửa
                      </button>
                      <ConfirmAction
                        label="Xóa"
                        confirmLabel="Xác nhận xóa?"
                        busy={busy}
                        className={ACTION_BUTTON}
                        onConfirm={() => remove.mutate(record.id)}
                      />
                      <button
                        type="button"
                        disabled={downloading}
                        onClick={() => certificate.mutate(record.id)}
                        className={`${ACTION_BUTTON} inline-flex items-center gap-1`}
                      >
                        <FiDownload
                          aria-hidden="true"
                          className="h-3.5 w-3.5"
                        />
                        {downloading ? "Đang tải…" : "Tải chứng nhận"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {editingId !== null &&
        (() => {
          const record = records.find((item) => item.id === editingId);
          return record !== undefined ? (
            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-950">
              <RecordForm
                initial={record}
                pending={update.isPending}
                submitLabel="Lưu thay đổi"
                onSubmit={(values) =>
                  update.mutate({ recordId: record.id, body: values })
                }
                onCancel={() => setEditingId(null)}
              />
            </div>
          ) : null;
        })()}
    </section>
  );
}
