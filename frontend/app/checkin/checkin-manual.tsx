"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { type FormEvent, useState } from "react";
import { FiCalendar } from "react-icons/fi";

import { useAuth } from "@/components/auth-provider";
import { EmptyState } from "@/components/empty-state";
import { ErrorBanner } from "@/components/error-banner";
import { FIELD_INPUT_CLASS } from "@/components/field";
import { apiFetch } from "@/lib/api";
import { buildCheckinUrl, parseCheckinPayload } from "@/lib/checkin";
import { formatDateTime } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import type { MyRegistrationsResponse } from "@/lib/types";

/**
 * Manual check-in entry — shown when the URL carried no usable `a`/`c`
 * params (or after an invalid QR payload).
 *
 * Two honest paths:
 *   1. paste a full payload (the QR URL or `a=…&c=…` text) — a bare 6-char
 *      code stays pending and gets paired with an activity picked below;
 *   2. pick one of the member's approved, not-yet-checked-in registrations
 *      and enter the code on that activity's page.
 */
export function CheckinManual({
  onTarget,
}: {
  onTarget: (target: { activityId: string; code: string }) => void;
}) {
  const { token, status } = useAuth();
  const [raw, setRaw] = useState("");
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mine = useQuery({
    queryKey: qk.meRegistrations,
    queryFn: ({ signal }) =>
      apiFetch<MyRegistrationsResponse>("/api/me/registrations", {
        token: token ?? undefined,
        signal,
      }),
    enabled: token !== null,
  });

  const approved = (mine.data?.registrations ?? []).filter(
    (item) =>
      item.registration.status === "approved" &&
      item.registration.checked_in_at === null &&
      item.activity.status === "published",
  );

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const parsed = parseCheckinPayload(raw);
    if (parsed === null) {
      setPendingCode(null);
      setError("Không đọc được mã điểm danh, hãy kiểm tra lại");
      return;
    }
    if (parsed.activityId === null) {
      // Bare code — keep it and let the member pick the activity below.
      setPendingCode(parsed.code);
      setRaw("");
      return;
    }
    onTarget({ activityId: parsed.activityId, code: parsed.code });
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Điểm danh</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Quét mã QR tại sự kiện, hoặc dán liên kết/mã điểm danh vào đây.
        </p>
      </header>

      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label htmlFor="checkin-payload" className="text-sm font-medium">
          Dán mã QR hoặc liên kết điểm danh
        </label>
        <textarea
          id="checkin-payload"
          rows={2}
          value={raw}
          onChange={(event) => setRaw(event.target.value)}
          placeholder="https://…/checkin?a=…&c=…"
          className={FIELD_INPUT_CLASS}
        />
        <ErrorBanner error={error} />
        {pendingCode !== null && (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Mã{" "}
            <span className="font-mono font-bold tracking-[0.3em]">
              {pendingCode}
            </span>{" "}
            đã sẵn sàng — chọn hoạt động bên dưới để điểm danh.
          </p>
        )}
        <button
          type="submit"
          disabled={status === "loading"}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          Tiếp tục
        </button>
      </form>

      <section
        aria-labelledby="checkin-upcoming"
        className="flex flex-col gap-3"
      >
        <h2 id="checkin-upcoming" className="text-base font-semibold">
          Hoạt động có thể điểm danh
        </h2>
        {mine.isPending && (
          <output className="block text-sm text-neutral-500 dark:text-neutral-400">
            Đang tải đăng ký của bạn…
          </output>
        )}
        {mine.isError && <ErrorBanner error={mine.error} />}
        {mine.isSuccess &&
          (approved.length === 0 ? (
            <EmptyState
              icon={FiCalendar}
              title="Không có hoạt động nào chờ điểm danh"
              hint="Bạn cần đăng ký và được duyệt trước khi điểm danh."
              action={{ href: "/dashboard", label: "Về bảng tin" }}
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {approved.map((item) => (
                <li key={item.registration.id}>
                  <Link
                    href={
                      pendingCode === null
                        ? `/activities/${item.activity.id}`
                        : buildCheckinUrl(item.activity.id, pendingCode)
                    }
                    className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-neutral-900 dark:text-neutral-100">
                        {item.activity.title}
                      </span>
                      <span className="text-xs text-neutral-500 dark:text-neutral-400">
                        {item.org.name} ·{" "}
                        {formatDateTime(item.activity.starts_at)}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs font-medium text-neutral-600 dark:text-neutral-300">
                      Điểm danh →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ))}
      </section>
    </div>
  );
}
