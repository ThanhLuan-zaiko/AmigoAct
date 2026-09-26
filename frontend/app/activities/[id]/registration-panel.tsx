"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { ConfirmAction } from "@/components/confirm-action";
import { ErrorBanner } from "@/components/error-banner";
import { StatusChip } from "@/components/status-chip";
import { apiFetch } from "@/lib/api";
import { normalizeCheckinCode } from "@/lib/checkin";
import { formatDateTime } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import type {
  ActivityStatus,
  CheckinResponse,
  Registration,
} from "@/lib/types";

const SECTION_CLASS =
  "rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900";

const PRIMARY_BUTTON =
  "rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300";

/**
 * The caller's registration state machine on the activity page:
 *
 *   none/cancelled → register form (published activities only)
 *   pending        → "Chờ duyệt" + cancel
 *   approved       → check-in entry (or "Đã điểm danh…"), cancel until then
 *   rejected       → terminal note
 *
 * All mutations invalidate the activity + member query keys so WS-driven
 * and local updates converge on the same data.
 */
export function RegistrationPanel({
  activityId,
  orgId,
  status,
  registration,
}: {
  activityId: string;
  orgId: string;
  status: ActivityStatus;
  registration: Registration | null;
}) {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<CheckinResponse | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: qk.activity(activityId) });
    void queryClient.invalidateQueries({ queryKey: qk.meRegistrations });
    void queryClient.invalidateQueries({ queryKey: qk.feed });
    void queryClient.invalidateQueries({ queryKey: qk.orgActivities(orgId) });
  };

  const register = useMutation({
    mutationFn: () =>
      apiFetch<{ registration: Registration }>(
        `/api/activities/${activityId}/register`,
        {
          method: "POST",
          body: note.trim() === "" ? {} : { note: note.trim() },
          token: token ?? undefined,
        },
      ),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: setError,
  });

  const cancel = useMutation({
    mutationFn: (registrationId: string) =>
      apiFetch<{ registration: Registration }>(
        `/api/registrations/${registrationId}/cancel`,
        { method: "POST", token: token ?? undefined },
      ),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: setError,
  });

  const checkin = useMutation({
    mutationFn: (normalized: string) =>
      apiFetch<CheckinResponse>(`/api/activities/${activityId}/checkin`, {
        method: "POST",
        body: { code: normalized },
        token: token ?? undefined,
      }),
    onSuccess: (data) => {
      setError(null);
      setResult(data);
      refresh();
    },
    onError: setError,
  });

  const submitCheckin = () => {
    const normalized = normalizeCheckinCode(code);
    if (normalized === null) {
      setError("Mã điểm danh gồm 6 ký tự hợp lệ");
      return;
    }
    checkin.mutate(normalized);
  };

  // A cancelled registration on a no-longer-published activity gets no
  // re-register CTA, but the member still sees its terminal state.
  if (
    registration !== null &&
    registration.status === "cancelled" &&
    status !== "published"
  ) {
    return (
      <section className={SECTION_CLASS}>
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold">Đăng ký của bạn</h2>
          <StatusChip status="cancelled" />
        </div>
      </section>
    );
  }

  if (registration === null || registration.status === "cancelled") {
    if (status !== "published") {
      return null;
    }
    return (
      <section className={SECTION_CLASS}>
        <h2 className="text-base font-semibold">Đăng ký tham gia</h2>
        <textarea
          rows={2}
          maxLength={500}
          placeholder="Ghi chú cho ban tổ chức (không bắt buộc)"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          aria-label="Ghi chú đăng ký"
          className="mt-3 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-500"
        />
        <ErrorBanner error={error} />
        <button
          type="button"
          disabled={register.isPending}
          onClick={() => register.mutate()}
          className={`mt-3 ${PRIMARY_BUTTON}`}
        >
          {register.isPending
            ? "Đang đăng ký…"
            : registration === null
              ? "Đăng ký"
              : "Đăng ký lại"}
        </button>
      </section>
    );
  }

  if (registration.status === "pending") {
    return (
      <section className={SECTION_CLASS}>
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold">Đăng ký của bạn</h2>
          <StatusChip status="pending" />
        </div>
        <ErrorBanner error={error} />
        <div className="mt-3">
          <ConfirmAction
            label="Hủy đăng ký"
            busy={cancel.isPending}
            onConfirm={() => cancel.mutate(registration.id)}
          />
        </div>
      </section>
    );
  }

  if (registration.status === "rejected") {
    return (
      <section className={SECTION_CLASS}>
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold">Đăng ký của bạn</h2>
          <StatusChip status="rejected" />
        </div>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Đăng ký của bạn đã bị từ chối.
        </p>
      </section>
    );
  }

  // approved
  const checkedInAt = registration.checked_in_at;
  return (
    <section className={SECTION_CLASS}>
      <div className="flex items-center gap-3">
        <h2 className="text-base font-semibold">Đăng ký của bạn</h2>
        <StatusChip status="approved" />
      </div>
      {result !== null ? (
        <output className="mt-2 block text-sm text-emerald-700 dark:text-emerald-300">
          {result.already_checked_in
            ? `Bạn đã điểm danh lúc ${formatDateTime(result.registration.checked_in_at ?? "")}`
            : `Điểm danh thành công lúc ${formatDateTime(result.registration.checked_in_at ?? "")}`}
        </output>
      ) : checkedInAt !== null ? (
        <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-300">
          Đã điểm danh lúc {formatDateTime(checkedInAt)}
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Mã điểm danh
            <input
              type="text"
              autoComplete="off"
              maxLength={8}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="Ví dụ KM2P4R"
              className="w-44 rounded-lg border border-neutral-300 bg-white px-3 py-2 font-mono text-base tracking-[0.3em] uppercase placeholder:font-sans placeholder:text-xs placeholder:tracking-normal placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-500"
            />
          </label>
          <ErrorBanner error={error} />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={checkin.isPending}
              onClick={submitCheckin}
              className={PRIMARY_BUTTON}
            >
              {checkin.isPending ? "Đang điểm danh…" : "Điểm danh"}
            </button>
            <ConfirmAction
              label="Hủy đăng ký"
              busy={cancel.isPending}
              onConfirm={() => cancel.mutate(registration.id)}
            />
          </div>
        </div>
      )}
    </section>
  );
}
