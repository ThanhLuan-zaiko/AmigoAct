"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { FiCheckCircle } from "react-icons/fi";

import { useAuth } from "@/components/auth-provider";
import { ErrorBanner } from "@/components/error-banner";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import type { ActivityDetailResponse, CheckinResponse } from "@/lib/types";

/**
 * Explicit check-in confirmation — the user always presses "Điểm danh"
 * themselves; a QR scan must never mutate without a gesture (prefetch or
 * prerender would otherwise check them in silently).
 *
 * The activity title is loaded for context, but the check-in POST is the
 * real gate — a failed title fetch does not block the flow.
 */
export function CheckinConfirm({
  activityId,
  code,
}: {
  activityId: string;
  code: string;
}) {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [result, setResult] = useState<CheckinResponse | null>(null);
  const [error, setError] = useState<unknown>(null);

  const detail = useQuery({
    queryKey: qk.activity(activityId),
    queryFn: ({ signal }) =>
      apiFetch<ActivityDetailResponse>(`/api/activities/${activityId}`, {
        token: token ?? undefined,
        signal,
      }),
    enabled: token !== null,
    retry: false,
  });

  const checkin = useMutation({
    mutationFn: () =>
      apiFetch<CheckinResponse>(`/api/activities/${activityId}/checkin`, {
        method: "POST",
        body: { code },
        token: token ?? undefined,
      }),
    onSuccess: (data) => {
      setError(null);
      setResult(data);
      void queryClient.invalidateQueries({
        queryKey: qk.activity(activityId),
      });
      void queryClient.invalidateQueries({ queryKey: qk.meRegistrations });
      void queryClient.invalidateQueries({ queryKey: qk.feed });
    },
    onError: setError,
  });

  const cardClass =
    "mx-auto w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900";

  if (result !== null) {
    return (
      <div className={`${cardClass} text-center`}>
        <FiCheckCircle
          aria-hidden="true"
          className="mx-auto h-10 w-10 text-emerald-600 dark:text-emerald-400"
        />
        <h1 className="mt-3 text-lg font-semibold">
          {result.already_checked_in
            ? "Bạn đã điểm danh trước đó"
            : "Điểm danh thành công"}
        </h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          lúc {formatDateTime(result.registration.checked_in_at ?? "")}
        </p>
        <Link
          href={`/activities/${activityId}`}
          className="mt-5 inline-block rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          Xem hoạt động
        </Link>
      </div>
    );
  }

  const title = detail.data?.activity.title;
  return (
    <div className={cardClass}>
      <h1 className="text-lg font-semibold">Điểm danh cho hoạt động này?</h1>
      {detail.isPending && (
        <output className="mt-1 block text-sm text-neutral-500 dark:text-neutral-400">
          Đang tải tên hoạt động…
        </output>
      )}
      {title !== undefined && (
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          {title}
        </p>
      )}
      <p className="mt-4 text-center font-mono text-2xl font-bold tracking-[0.35em]">
        {code}
      </p>
      <div className="mt-4">
        <ErrorBanner error={error} />
      </div>
      <button
        type="button"
        disabled={checkin.isPending}
        onClick={() => checkin.mutate()}
        className="mt-4 w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
      >
        {checkin.isPending ? "Đang điểm danh…" : "Điểm danh"}
      </button>
    </div>
  );
}
