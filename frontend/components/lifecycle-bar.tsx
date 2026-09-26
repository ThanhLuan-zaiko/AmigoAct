"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { ConfirmAction } from "@/components/confirm-action";
import { ErrorBanner } from "@/components/error-banner";
import { apiFetch } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import type { Activity, CompleteResponse } from "@/lib/types";

type Transition = "publish" | "cancel" | "complete";

/**
 * Lifecycle actions on the manage console:
 *
 *   draft     → "Công bố"
 *   published → "Hủy hoạt động" + "Hoàn thành" (both behind inline confirm)
 *   terminal  → no actions (the status chip in the header already says it)
 *
 * `complete` additionally surfaces `records_created` from the response.
 */
export function LifecycleBar({ activity }: { activity: Activity }) {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);

  const transition = useMutation({
    mutationFn: (action: Transition) =>
      apiFetch<{ activity: Activity; records_created?: number }>(
        `/api/activities/${activity.id}/${action}`,
        { method: "POST", token: token ?? undefined },
      ),
    onSuccess: (data, action) => {
      setError(null);
      if (action === "complete") {
        const created = (data as CompleteResponse).records_created ?? 0;
        setDoneMessage(`Đã ghi nhận ${created} thành tích`);
      }
      void queryClient.invalidateQueries({
        queryKey: qk.activity(activity.id),
      });
      void queryClient.invalidateQueries({
        queryKey: qk.orgActivities(activity.org_id),
      });
    },
    onError: setError,
  });

  if (activity.status === "cancelled" || activity.status === "completed") {
    return null;
  }

  return (
    <section
      aria-label="Vòng đời hoạt động"
      className="flex flex-wrap items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
    >
      {activity.status === "draft" && (
        <button
          type="button"
          disabled={transition.isPending}
          onClick={() => transition.mutate("publish")}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {transition.isPending ? "Đang xử lý…" : "Công bố"}
        </button>
      )}
      {activity.status === "published" && (
        <>
          <ConfirmAction
            label="Hoàn thành"
            confirmLabel="Xác nhận hoàn thành?"
            busy={transition.isPending}
            onConfirm={() => transition.mutate("complete")}
          />
          <ConfirmAction
            label="Hủy hoạt động"
            confirmLabel="Xác nhận hủy?"
            busy={transition.isPending}
            onConfirm={() => transition.mutate("cancel")}
          />
        </>
      )}
      {doneMessage !== null && (
        <output className="text-sm text-emerald-700 dark:text-emerald-300">
          {doneMessage}
        </output>
      )}
      <ErrorBanner error={error} />
    </section>
  );
}
