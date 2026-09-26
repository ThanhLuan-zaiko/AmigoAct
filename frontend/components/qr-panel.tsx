"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { ConfirmAction } from "@/components/confirm-action";
import { ErrorBanner } from "@/components/error-banner";
import { apiFetch } from "@/lib/api";
import { buildCheckinUrl } from "@/lib/checkin";
import { qk } from "@/lib/query-keys";
import type { ActivityStatus, CheckinCodeResponse } from "@/lib/types";

const SECONDARY_BUTTON =
  "rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800";

/**
 * Check-in code panel on the manage console.
 *
 * The activity detail carries `checkin_code` (manager-only field): when a
 * code exists this renders its QR + the 6-char code large; when absent the
 * manager explicitly creates one with "Tạo mã điểm danh" — the ensure
 * endpoint is a write, so it waits for a click rather than firing on mount
 * (a prefetched/prerendered page must not mutate). "Đổi mã" rotates and
 * "Tắt mã" revokes (inline confirm). Code actions exist only while the
 * activity is draft/published — the contract allows nothing else.
 *
 * The `{checked_in}/{approved}` counter is fed by the parent from the
 * activity detail + approved registrations queries, refreshed by WS.
 */
export function QrPanel({
  activityId,
  status,
  checkinCode,
  approved,
  checkedIn,
}: {
  activityId: string;
  status: ActivityStatus;
  checkinCode: string | null;
  approved: number;
  checkedIn: number;
}) {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: qk.activity(activityId) });

  const ensure = useMutation({
    mutationFn: (rotate: boolean) =>
      apiFetch<CheckinCodeResponse>(
        `/api/activities/${activityId}/checkin-code`,
        {
          method: "POST",
          body: { rotate },
          token: token ?? undefined,
        },
      ),
    onSuccess: () => {
      setError(null);
      void invalidate();
    },
    onError: setError,
  });

  const revoke = useMutation({
    mutationFn: () =>
      apiFetch<void>(`/api/activities/${activityId}/checkin-code`, {
        method: "DELETE",
        token: token ?? undefined,
      }),
    onSuccess: () => {
      setError(null);
      void invalidate();
    },
    onError: setError,
  });

  const manageable = status === "draft" || status === "published";
  if (!manageable && checkinCode === null) {
    // A terminal activity without a code has nothing left to show here.
    return null;
  }

  return (
    <section
      aria-labelledby="qr-panel-title"
      className="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="qr-panel-title" className="text-base font-semibold">
          Mã điểm danh
        </h2>
        <span className="ml-auto text-sm tabular-nums text-neutral-600 dark:text-neutral-400">
          Đã điểm danh {checkedIn}/{approved}
        </span>
      </div>

      {checkinCode === null ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Chưa có mã điểm danh. Tạo mã để thành viên quét QR hoặc nhập tay.
          </p>
          <button
            type="button"
            disabled={ensure.isPending || !manageable}
            onClick={() => ensure.mutate(false)}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
          >
            {ensure.isPending ? "Đang tạo…" : "Tạo mã điểm danh"}
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-4">
          <QRCodeSVG
            value={new URL(
              buildCheckinUrl(activityId, checkinCode),
              window.location.origin,
            ).toString()}
            size={256}
            className="rounded-lg border border-neutral-200 dark:border-neutral-700"
          />
          <p className="font-mono text-3xl font-bold tracking-[0.35em]">
            {checkinCode}
          </p>
          {manageable && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={ensure.isPending}
                onClick={() => ensure.mutate(true)}
                className={SECONDARY_BUTTON}
              >
                {ensure.isPending ? "Đang đổi…" : "Đổi mã"}
              </button>
              <ConfirmAction
                label="Tắt mã"
                confirmLabel="Xác nhận tắt mã?"
                busy={revoke.isPending}
                onConfirm={() => revoke.mutate()}
              />
            </div>
          )}
        </div>
      )}

      <ErrorBanner error={error} />
    </section>
  );
}
