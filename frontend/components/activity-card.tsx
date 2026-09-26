import Link from "next/link";
import { FiClock, FiMapPin, FiUsers } from "react-icons/fi";

import { StatusChip } from "@/components/status-chip";
import { formatDateTime, formatHours } from "@/lib/format";
import type { Activity } from "@/lib/types";

/**
 * One activity row/card linking to its detail page. Used on the org page
 * list — shows the honest counts and schedule, nothing invented.
 */
export function ActivityCard({
  activity,
  registered,
  checkedIn,
}: {
  activity: Activity;
  registered: number;
  checkedIn: number;
}) {
  return (
    <li>
      <Link
        href={`/activities/${activity.id}`}
        className="block rounded-2xl border border-neutral-200 bg-white p-5 transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 font-semibold text-neutral-900 dark:text-neutral-50">
            {activity.title}
          </h3>
          <StatusChip status={activity.status} />
        </div>
        <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-neutral-600 dark:text-neutral-400">
          <div className="flex items-center gap-1.5">
            <FiClock aria-hidden="true" className="h-3.5 w-3.5" />
            <span>
              {formatDateTime(activity.starts_at)} –{" "}
              {formatDateTime(activity.ends_at)}
            </span>
          </div>
          {activity.location !== null && (
            <div className="flex items-center gap-1.5">
              <FiMapPin aria-hidden="true" className="h-3.5 w-3.5" />
              <span>{activity.location}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <FiUsers aria-hidden="true" className="h-3.5 w-3.5" />
            <span>
              Đăng ký {registered}
              {activity.capacity !== null && `/${activity.capacity}`} · Điểm
              danh {checkedIn}
            </span>
          </div>
        </dl>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          {formatHours(Number(activity.hours))} giờ ·{" "}
          {formatHours(Number(activity.points))} điểm
        </p>
      </Link>
    </li>
  );
}
