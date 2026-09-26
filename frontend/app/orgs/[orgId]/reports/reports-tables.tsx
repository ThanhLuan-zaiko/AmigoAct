"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { StatusChip } from "@/components/status-chip";
import { formatDateTime, formatHours } from "@/lib/format";
import type {
  ActivityReportRow,
  FacultyReport,
  ReportMonth,
  TopVolunteer,
} from "@/lib/types";

/** Shown under every empty report section — honest, not a fake chart. */
const EMPTY_RANGE = "Chưa có dữ liệu trong khoảng này";

const TABLE = "w-full text-left text-sm";
const HEAD_ROW =
  "border-b border-neutral-200 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400";
const HEAD_CELL = "py-2 pr-4 font-medium";
const CELL = "py-2.5 pr-4";
const NUM_CELL = `${CELL} tabular-nums`;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function EmptyNote() {
  return (
    <p className="text-sm text-neutral-500 dark:text-neutral-400">
      {EMPTY_RANGE}
    </p>
  );
}

/** `YYYY-MM` → `MM/YYYY` — pure string work, no timezone shift. */
function monthLabel(month: string): string {
  return `${month.slice(5, 7)}/${month.slice(0, 4)}`;
}

/** Monthly buckets with a proportional mini bar behind the hours cell. */
export function MonthlyTable({ rows }: { rows: ReportMonth[] }) {
  const maxHours = Math.max(0, ...rows.map((row) => Number(row.hours)));
  return (
    <Section title="Theo tháng">
      {rows.length === 0 ? (
        <EmptyNote />
      ) : (
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <thead>
              <tr className={HEAD_ROW}>
                <th className={HEAD_CELL}>Tháng</th>
                <th className={HEAD_CELL}>Hoạt động</th>
                <th className={HEAD_CELL}>Đăng ký</th>
                <th className="py-2 font-medium">Giờ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const hours = Number(row.hours);
                const width = maxHours > 0 ? (hours / maxHours) * 100 : 0;
                return (
                  <tr
                    key={row.month}
                    className="border-b border-neutral-100 last:border-0 dark:border-neutral-800"
                  >
                    <td className={`${CELL} tabular-nums`}>
                      {monthLabel(row.month)}
                    </td>
                    <td className={NUM_CELL}>{row.activities}</td>
                    <td className={NUM_CELL}>{row.registrations}</td>
                    <td className={`${NUM_CELL} w-1/3`}>
                      <span>{formatHours(hours)}</span>
                      <div
                        aria-hidden="true"
                        className="mt-1 h-1.5 w-full max-w-40 overflow-hidden rounded bg-neutral-100 dark:bg-neutral-800"
                      >
                        <div
                          className="h-full rounded bg-emerald-500 dark:bg-emerald-600"
                          style={{ width: `${width}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

/** Members/hours/points grouped by faculty (`null` → "—"). */
export function FacultyTable({ rows }: { rows: FacultyReport[] }) {
  return (
    <Section title="Theo khoa">
      {rows.length === 0 ? (
        <EmptyNote />
      ) : (
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <thead>
              <tr className={HEAD_ROW}>
                <th className={HEAD_CELL}>Khoa</th>
                <th className={HEAD_CELL}>Thành viên</th>
                <th className={HEAD_CELL}>Giờ</th>
                <th className="py-2 font-medium">Điểm</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={row.faculty ?? index}
                  className="border-b border-neutral-100 last:border-0 dark:border-neutral-800"
                >
                  <td className={CELL}>{row.faculty ?? "—"}</td>
                  <td className={NUM_CELL}>{row.members}</td>
                  <td className={NUM_CELL}>{formatHours(Number(row.hours))}</td>
                  <td className={NUM_CELL}>
                    {formatHours(Number(row.points))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

/** Ranked list of the org's most-awarded members. */
export function TopVolunteers({ rows }: { rows: TopVolunteer[] }) {
  return (
    <Section title="Top tình nguyện viên">
      {rows.length === 0 ? (
        <EmptyNote />
      ) : (
        <ol className="flex flex-col gap-2">
          {rows.map((volunteer, index) => (
            <li
              key={volunteer.member_id}
              className="flex items-center gap-3 rounded-xl border border-neutral-200 px-4 py-3 dark:border-neutral-800"
            >
              <span className="w-6 shrink-0 text-center text-sm font-semibold text-neutral-500 tabular-nums dark:text-neutral-400">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-neutral-900 dark:text-neutral-100">
                  {volunteer.full_name}
                </p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  {[volunteer.student_code, volunteer.faculty]
                    .filter((part): part is string => !!part)
                    .join(" · ") || "—"}
                </p>
              </div>
              <span className="shrink-0 text-right text-xs tabular-nums text-neutral-600 dark:text-neutral-400">
                {formatHours(Number(volunteer.hours))} giờ ·{" "}
                {formatHours(Number(volunteer.points))} điểm ·{" "}
                {volunteer.record_count} thành tích
              </span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

/** Per-activity rollup with links back to the activity pages. */
export function ActivityReportTable({ rows }: { rows: ActivityReportRow[] }) {
  return (
    <Section title="Theo hoạt động">
      {rows.length === 0 ? (
        <EmptyNote />
      ) : (
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <thead>
              <tr className={HEAD_ROW}>
                <th className={HEAD_CELL}>Hoạt động</th>
                <th className={HEAD_CELL}>Trạng thái</th>
                <th className={HEAD_CELL}>Sức chứa</th>
                <th className={HEAD_CELL}>ĐK / Duyệt / ĐD</th>
                <th className="py-2 font-medium">Giờ / Điểm</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-neutral-100 last:border-0 dark:border-neutral-800"
                >
                  <td className={CELL}>
                    <Link
                      href={`/activities/${row.id}`}
                      className="font-medium text-neutral-900 underline-offset-4 hover:underline dark:text-neutral-100"
                    >
                      {row.title}
                    </Link>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      {formatDateTime(row.starts_at)}
                    </p>
                  </td>
                  <td className={CELL}>
                    <StatusChip status={row.status} />
                  </td>
                  <td className={NUM_CELL}>{row.capacity ?? "—"}</td>
                  <td className={NUM_CELL}>
                    {row.registered} / {row.approved} / {row.checked_in}
                  </td>
                  <td className={NUM_CELL}>
                    {formatHours(Number(row.hours_awarded))} giờ ·{" "}
                    {formatHours(Number(row.points_awarded))} điểm
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
