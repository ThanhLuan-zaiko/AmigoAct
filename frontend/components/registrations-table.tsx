"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FiInbox } from "react-icons/fi";

import { useAuth } from "@/components/auth-provider";
import { ConfirmAction } from "@/components/confirm-action";
import { EmptyState } from "@/components/empty-state";
import { ErrorBanner } from "@/components/error-banner";
import { StatusChip } from "@/components/status-chip";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { REGISTRATION_STATUS_LABELS } from "@/lib/labels";
import { qk } from "@/lib/query-keys";
import type {
  Registration,
  RegistrationStatus,
  RegistrationsResponse,
} from "@/lib/types";

const FILTER_TABS: readonly (RegistrationStatus | undefined)[] = [
  undefined,
  "pending",
  "approved",
  "rejected",
  "cancelled",
];

const TAB_ALL_LABEL = "Tất cả";

const ACTION_BUTTON =
  "rounded-lg border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800";

/**
 * Manager's registrations console for one activity: status filter tabs +
 * a member table with per-row actions.
 *
 *   pending  → "Duyệt" / "Từ chối" (review endpoint; reject is confirmed)
 *   approved → "Điểm danh thủ công" while `checked_in_at` is null
 *   others   → read-only
 *
 * Every mutation invalidates the `["activity-regs", id]` prefix (all filter
 * variants) and the activity detail so the live counters stay honest.
 */
export function RegistrationsTable({ activityId }: { activityId: string }) {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<RegistrationStatus | undefined>(
    undefined,
  );
  const [error, setError] = useState<unknown>(null);

  const regs = useQuery({
    queryKey: qk.activityRegs(activityId, filter),
    queryFn: ({ signal }) =>
      apiFetch<RegistrationsResponse>(
        `/api/activities/${activityId}/registrations${
          filter === undefined ? "" : `?status=${filter}`
        }`,
        { token: token ?? undefined, signal },
      ),
    enabled: token !== null,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: qk.activityRegs(activityId),
    });
    void queryClient.invalidateQueries({ queryKey: qk.activity(activityId) });
    void queryClient.invalidateQueries({ queryKey: qk.meRegistrations });
  };

  const review = useMutation({
    mutationFn: ({
      registrationId,
      action,
    }: {
      registrationId: string;
      action: "approve" | "reject";
    }) =>
      apiFetch<{ registration: Registration }>(
        `/api/registrations/${registrationId}/review`,
        {
          method: "POST",
          body: { action },
          token: token ?? undefined,
        },
      ),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: setError,
  });

  const manualCheckin = useMutation({
    mutationFn: (registrationId: string) =>
      apiFetch(`/api/registrations/${registrationId}/checkin`, {
        method: "POST",
        token: token ?? undefined,
      }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: setError,
  });

  const busy = review.isPending || manualCheckin.isPending;

  return (
    <section
      aria-labelledby="regs-title"
      className="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="regs-title" className="text-base font-semibold">
          Đăng ký
        </h2>
        <div className="ml-auto flex flex-wrap gap-1">
          {FILTER_TABS.map((value) => (
            <button
              key={value ?? "all"}
              type="button"
              onClick={() => setFilter(value)}
              aria-pressed={filter === value}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                filter === value
                  ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                  : "border-neutral-300 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
              }`}
            >
              {value === undefined
                ? TAB_ALL_LABEL
                : REGISTRATION_STATUS_LABELS[value]}
            </button>
          ))}
        </div>
      </div>

      {regs.isPending && (
        <output className="block text-sm text-neutral-500 dark:text-neutral-400">
          Đang tải đăng ký…
        </output>
      )}
      {regs.isError && <ErrorBanner error={regs.error} />}
      {error !== null && <ErrorBanner error={error} />}

      {regs.isSuccess &&
        (regs.data.registrations.length === 0 ? (
          <EmptyState icon={FiInbox} title="Chưa có đăng ký" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                  <th className="py-2 pr-4 font-medium">Thành viên</th>
                  <th className="py-2 pr-4 font-medium">Ghi chú</th>
                  <th className="py-2 pr-4 font-medium">Trạng thái</th>
                  <th className="py-2 font-medium">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {regs.data.registrations.map((row) => {
                  const { registration, member } = row;
                  const meta = [
                    member.student_code,
                    member.class_name,
                    member.faculty,
                  ]
                    .filter((part): part is string => !!part)
                    .join(" · ");
                  return (
                    <tr
                      key={registration.id}
                      className="border-b border-neutral-100 align-top last:border-0 dark:border-neutral-800"
                    >
                      <td className="py-3 pr-4">
                        <p className="font-medium text-neutral-900 dark:text-neutral-100">
                          {member.full_name}
                        </p>
                        <p className="text-xs text-neutral-500 dark:text-neutral-400">
                          {[meta, member.email].filter(Boolean).join(" · ")}
                        </p>
                      </td>
                      <td className="py-3 pr-4 text-neutral-600 dark:text-neutral-400">
                        {registration.note ?? "—"}
                      </td>
                      <td className="py-3 pr-4">
                        <StatusChip status={registration.status} />
                        {registration.checked_in_at !== null && (
                          <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">
                            Điểm danh{" "}
                            {formatDateTime(registration.checked_in_at)}
                          </p>
                        )}
                      </td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-2">
                          {registration.status === "pending" && (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  review.mutate({
                                    registrationId: registration.id,
                                    action: "approve",
                                  })
                                }
                                className={ACTION_BUTTON}
                              >
                                Duyệt
                              </button>
                              <ConfirmAction
                                label="Từ chối"
                                busy={busy}
                                className={ACTION_BUTTON}
                                onConfirm={() =>
                                  review.mutate({
                                    registrationId: registration.id,
                                    action: "reject",
                                  })
                                }
                              />
                            </>
                          )}
                          {registration.status === "approved" &&
                            registration.checked_in_at === null && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  manualCheckin.mutate(registration.id)
                                }
                                className={ACTION_BUTTON}
                              >
                                Điểm danh thủ công
                              </button>
                            )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
    </section>
  );
}
