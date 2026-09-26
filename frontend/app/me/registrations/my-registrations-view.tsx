"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { FiCalendar } from "react-icons/fi";

import { useAuth } from "@/components/auth-provider";
import { ConfirmAction } from "@/components/confirm-action";
import { EmptyState } from "@/components/empty-state";
import { ErrorBanner } from "@/components/error-banner";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { REGISTRATION_STATUS_LABELS } from "@/lib/labels";
import { qk } from "@/lib/query-keys";
import type {
  MyRegistrationItem,
  MyRegistrationsResponse,
  RegistrationStatus,
} from "@/lib/types";

/** Display order for the status groups. */
const GROUP_ORDER: readonly RegistrationStatus[] = [
  "approved",
  "pending",
  "rejected",
  "cancelled",
];

/** A registration may be cancelled while pending, or while approved on a
 * still-published activity before check-in. */
function canCancel(item: MyRegistrationItem): boolean {
  const { registration, activity } = item;
  if (registration.status === "pending") {
    return true;
  }
  return (
    registration.status === "approved" &&
    registration.checked_in_at === null &&
    activity.status === "published"
  );
}

/**
 * The member's own registrations, grouped by status. Cancel goes through
 * `POST /api/registrations/{id}/cancel` behind an inline confirm; the
 * server decides the rest (`cannot_cancel` still surfaces honestly).
 */
export function MyRegistrationsView() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown>(null);

  const mine = useQuery({
    queryKey: qk.meRegistrations,
    queryFn: ({ signal }) =>
      apiFetch<MyRegistrationsResponse>("/api/me/registrations", {
        token: token ?? undefined,
        signal,
      }),
    enabled: token !== null,
  });

  const cancel = useMutation({
    mutationFn: (item: MyRegistrationItem) =>
      apiFetch(`/api/registrations/${item.registration.id}/cancel`, {
        method: "POST",
        token: token ?? undefined,
      }),
    onSuccess: (_data, item) => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: qk.meRegistrations });
      void queryClient.invalidateQueries({
        queryKey: qk.activity(item.activity.id),
      });
      void queryClient.invalidateQueries({ queryKey: qk.feed });
    },
    onError: setError,
  });

  if (mine.isPending) {
    return (
      <output className="block px-4 py-16 text-center text-sm text-neutral-500 dark:text-neutral-400">
        Đang tải đăng ký…
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

  const groups = new Map<RegistrationStatus, MyRegistrationItem[]>();
  for (const item of mine.data.registrations) {
    const list = groups.get(item.registration.status) ?? [];
    list.push(item);
    groups.set(item.registration.status, list);
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Đăng ký của tôi</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Các hoạt động bạn đã đăng ký, nhóm theo trạng thái.
        </p>
      </header>

      <ErrorBanner error={error} />

      {mine.data.registrations.length === 0 ? (
        <EmptyState
          icon={FiCalendar}
          title="Bạn chưa đăng ký hoạt động nào"
          hint="Vào trang tổ chức để xem và đăng ký hoạt động."
          action={{ href: "/dashboard", label: "Về bảng tin" }}
        />
      ) : (
        GROUP_ORDER.map((status) => {
          const items = groups.get(status);
          if (items === undefined || items.length === 0) {
            return null;
          }
          return (
            <section
              key={status}
              aria-labelledby={`regs-${status}`}
              className="flex flex-col gap-2"
            >
              <h2
                id={`regs-${status}`}
                className="text-sm font-semibold text-neutral-500 uppercase dark:text-neutral-400"
              >
                {REGISTRATION_STATUS_LABELS[status]} ({items.length})
              </h2>
              <ul className="flex flex-col gap-2">
                {items.map((item) => (
                  <li
                    key={item.registration.id}
                    className="flex flex-wrap items-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900"
                  >
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/activities/${item.activity.id}`}
                        className="font-medium text-neutral-900 underline-offset-4 hover:underline dark:text-neutral-100"
                      >
                        {item.activity.title}
                      </Link>
                      <p className="text-xs text-neutral-500 dark:text-neutral-400">
                        {item.org.name} ·{" "}
                        {formatDateTime(item.activity.starts_at)} –{" "}
                        {formatDateTime(item.activity.ends_at)}
                      </p>
                      {item.registration.checked_in_at !== null && (
                        <p className="mt-0.5 text-xs text-emerald-700 dark:text-emerald-300">
                          Đã điểm danh{" "}
                          {formatDateTime(item.registration.checked_in_at)}
                        </p>
                      )}
                      {item.registration.note !== null && (
                        <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                          Ghi chú: {item.registration.note}
                        </p>
                      )}
                    </div>
                    {canCancel(item) && (
                      <ConfirmAction
                        label="Hủy đăng ký"
                        busy={cancel.isPending}
                        onConfirm={() => cancel.mutate(item)}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
