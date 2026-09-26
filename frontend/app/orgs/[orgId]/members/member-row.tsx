"use client";

import Link from "next/link";

import { ConfirmAction } from "@/components/confirm-action";
import { FIELD_INPUT_CLASS } from "@/components/field";
import { formatDate, formatHours } from "@/lib/format";
import { MEMBER_ROLE_LABELS, MEMBER_STATUS_LABELS } from "@/lib/labels";
import type { MemberRole, MemberRow, MemberStatus } from "@/lib/types";

const ACTION_BUTTON =
  "rounded-lg border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800";

const STATUS_CHIP: Record<MemberStatus, string> = {
  active:
    "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  inactive:
    "border-neutral-300 bg-neutral-100 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400",
};

export interface Demotion {
  memberId: string;
  role: MemberRole;
}

/**
 * One roster row. Admins see a role `<select>` and the status toggle;
 * demotions arrive via `pendingDemotion` (the parent swaps the select for
 * a `ConfirmAction` pair). Everyone sees the "Thành tích" link; the self
 * row additionally gets "Chỉnh sửa hồ sơ".
 */
export function MemberRowItem({
  orgId,
  row,
  isSelf,
  canAdmin,
  busy,
  pendingDemotion,
  onPickRole,
  onConfirmDemotion,
  onCancelDemotion,
  onToggleStatus,
  onEditSelf,
}: {
  orgId: string;
  row: MemberRow;
  isSelf: boolean;
  canAdmin: boolean;
  busy: boolean;
  /** The demotion currently pending on this row, or `null`. */
  pendingDemotion: Demotion | null;
  onPickRole: (row: MemberRow, next: MemberRole) => void;
  onConfirmDemotion: () => void;
  onCancelDemotion: () => void;
  onToggleStatus: (row: MemberRow, next: MemberStatus) => void;
  onEditSelf: () => void;
}) {
  const meta = [row.student_code, row.class_name, row.faculty]
    .filter((part): part is string => !!part)
    .join(" · ");

  return (
    <tr className="border-b border-neutral-100 align-top last:border-0 dark:border-neutral-800">
      <td className="py-3 pr-4">
        <p className="font-medium text-neutral-900 dark:text-neutral-100">
          {row.full_name}
          {isSelf && (
            <span className="ml-1.5 text-xs text-neutral-500 dark:text-neutral-400">
              (bạn)
            </span>
          )}
        </p>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {row.email}
        </p>
      </td>
      <td className="py-3 pr-4 text-xs text-neutral-600 dark:text-neutral-400">
        {meta || "—"}
      </td>
      <td className="py-3 pr-4">
        {canAdmin && pendingDemotion === null ? (
          <select
            aria-label={`Vai trò của ${row.full_name}`}
            value={row.role}
            disabled={busy}
            onChange={(event) =>
              onPickRole(row, event.target.value as MemberRole)
            }
            className={FIELD_INPUT_CLASS}
          >
            {(["member", "manager", "admin"] as const).map((role) => (
              <option key={role} value={role}>
                {MEMBER_ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        ) : canAdmin && pendingDemotion !== null ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <ConfirmAction
              label={`Hạ quyền: ${MEMBER_ROLE_LABELS[pendingDemotion.role]}`}
              confirmLabel="Xác nhận?"
              busy={busy}
              className={ACTION_BUTTON}
              onConfirm={onConfirmDemotion}
            />
            <button
              type="button"
              className={ACTION_BUTTON}
              onClick={onCancelDemotion}
            >
              Giữ nguyên
            </button>
          </span>
        ) : (
          <span className="rounded-full border border-neutral-300 px-2.5 py-0.5 text-xs font-medium text-neutral-700 dark:border-neutral-700 dark:text-neutral-300">
            {MEMBER_ROLE_LABELS[row.role]}
          </span>
        )}
      </td>
      <td className="py-3 pr-4">
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_CHIP[row.status]}`}
        >
          {MEMBER_STATUS_LABELS[row.status]}
        </span>
      </td>
      <td className="py-3 pr-4 tabular-nums text-xs">
        {formatHours(Number(row.total_hours))} giờ ·{" "}
        {formatHours(Number(row.total_points))} điểm
      </td>
      <td className="py-3 pr-4 text-xs whitespace-nowrap text-neutral-600 dark:text-neutral-400">
        {formatDate(row.joined_at)}
      </td>
      <td className="py-3">
        <div className="flex flex-wrap gap-2">
          {canAdmin &&
            (row.status === "active" ? (
              <ConfirmAction
                label="Ngừng"
                confirmLabel="Xác nhận ngừng?"
                busy={busy}
                className={ACTION_BUTTON}
                onConfirm={() => onToggleStatus(row, "inactive")}
              />
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => onToggleStatus(row, "active")}
                className={ACTION_BUTTON}
              >
                Kích hoạt
              </button>
            ))}
          <Link
            href={`/orgs/${orgId}/members/${row.member_id}/records`}
            className={`${ACTION_BUTTON} inline-flex items-center`}
          >
            Thành tích
          </Link>
          {isSelf && (
            <button
              type="button"
              onClick={onEditSelf}
              className={ACTION_BUTTON}
            >
              Chỉnh sửa hồ sơ
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
