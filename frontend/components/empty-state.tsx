import Link from "next/link";
import type { IconType } from "react-icons";

/**
 * Honest empty state: an icon, a title, an optional hint and an optional
 * real next action (link). Never fake data — just guidance on what the
 * user can do next.
 */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
}: {
  /** Decorative icon from `react-icons` (rendered `aria-hidden`). */
  icon: IconType;
  title: string;
  hint?: string;
  /** Optional call-to-action link. */
  action?: { href: string; label: string };
}) {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-8 text-center dark:border-neutral-700 dark:bg-neutral-900">
      <Icon
        aria-hidden="true"
        className="mx-auto h-8 w-8 text-neutral-400 dark:text-neutral-500"
      />
      <p className="mt-3 font-medium text-neutral-900 dark:text-neutral-100">
        {title}
      </p>
      {hint !== undefined && (
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          {hint}
        </p>
      )}
      {action !== undefined && (
        <Link
          href={action.href}
          className="mt-5 inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-800 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
