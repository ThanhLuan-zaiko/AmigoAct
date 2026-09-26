import { statusLabel } from "@/lib/labels";
import type { ActivityStatus, RegistrationStatus } from "@/lib/types";

export type ChipStatus = ActivityStatus | RegistrationStatus;

/**
 * Border + background contrast pairs (no shadows, per docs/ui-design.md),
 * keyed by contract status. Active/success states are green, waiting states
 * amber, terminal-neutral states grey, terminal-bad states red, completed
 * sky.
 */
const CHIP_CLASSES: Record<ChipStatus, string> = {
  draft:
    "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
  published:
    "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  cancelled:
    "border-neutral-300 bg-neutral-100 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400",
  completed:
    "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300",
  pending:
    "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
  approved:
    "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  rejected:
    "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300",
};

/**
 * Small status pill — the single render site for activity and registration
 * status vocabulary. Contract values translate to Vietnamese labels via
 * `statusLabel`.
 */
export function StatusChip({ status }: { status: ChipStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${CHIP_CLASSES[status]}`}
    >
      {statusLabel(status)}
    </span>
  );
}
