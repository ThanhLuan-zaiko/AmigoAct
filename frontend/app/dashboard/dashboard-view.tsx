"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { FiCalendar, FiPlus, FiUserPlus } from "react-icons/fi";

import { useAuth } from "@/components/auth-provider";
import { EmptyState } from "@/components/empty-state";
import { ErrorBanner } from "@/components/error-banner";
import { SpeculationRules } from "@/components/speculation-rules";
import { StatusChip } from "@/components/status-chip";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { buildGreeting } from "@/lib/greeting";
import { MEMBER_ROLE_LABELS } from "@/lib/labels";
import { qk } from "@/lib/query-keys";
import type {
  FeedItem,
  FeedResponse,
  Membership,
  MeResponse,
} from "@/lib/types";

/** One row of the member feed: activity + org + own registration state. */
function FeedCard({ item }: { item: FeedItem }) {
  const { activity, org, my_registration_status: myStatus } = item;
  return (
    <li>
      <Link
        href={`/activities/${activity.id}`}
        className="block rounded-2xl border border-neutral-200 bg-white p-5 transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate font-semibold text-neutral-900 dark:text-neutral-50">
              {activity.title}
            </h3>
            <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
              {org.name}
            </p>
          </div>
          {myStatus !== null && <StatusChip status={myStatus} />}
        </div>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          {formatDateTime(activity.starts_at)} –{" "}
          {formatDateTime(activity.ends_at)}
          {activity.location !== null && ` · ${activity.location}`} · Đăng ký{" "}
          {item.registered}
        </p>
      </Link>
    </li>
  );
}

function MembershipCard({ membership }: { membership: Membership }) {
  const inactive = membership.status === "inactive";
  const meta = [
    membership.student_code && `Mã SV: ${membership.student_code}`,
    membership.class_name,
    membership.faculty,
  ]
    .filter((part): part is string => part !== null && part !== "")
    .join(" · ");

  return (
    <li>
      <Link
        href={`/orgs/${membership.org_id}`}
        className={`block rounded-2xl border border-neutral-200 bg-white p-5 transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800 ${
          inactive ? "opacity-70" : ""
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate font-semibold text-neutral-900 dark:text-neutral-50">
              {membership.org.name}
            </h3>
            <p className="mt-0.5 font-mono text-xs text-neutral-500 dark:text-neutral-400">
              {membership.org.code}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="rounded-full border border-neutral-300 px-2.5 py-0.5 text-xs font-medium text-neutral-700 dark:border-neutral-700 dark:text-neutral-300">
              {MEMBER_ROLE_LABELS[membership.role]}
            </span>
            {inactive && (
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                Ngừng hoạt động
              </span>
            )}
          </div>
        </div>
        {(meta || membership.joined_at) && (
          <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
            {meta && <span>{meta} · </span>}
            Tham gia {formatDateTime(membership.joined_at)}
          </p>
        )}
      </Link>
    </li>
  );
}

export function DashboardView() {
  const { user, token } = useAuth();
  const me = useQuery({
    queryKey: qk.me,
    queryFn: ({ signal }) =>
      apiFetch<MeResponse>("/api/auth/me", {
        token: token ?? undefined,
        signal,
      }),
    enabled: token !== null,
  });
  const feed = useQuery({
    queryKey: qk.feed,
    queryFn: ({ signal }) =>
      apiFetch<FeedResponse>("/api/me/feed", {
        token: token ?? undefined,
        signal,
      }),
    enabled: token !== null,
  });

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">
          {buildGreeting(user?.full_name)}
        </h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Các tổ chức bạn đang tham gia và hoạt động sắp tới.
        </p>
      </header>

      <section aria-labelledby="feed" className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id="feed" className="text-lg font-semibold">
            Hoạt động sắp tới
          </h2>
          <Link
            href="/me/registrations"
            className="text-sm font-medium text-neutral-700 underline-offset-4 hover:underline dark:text-neutral-300"
          >
            Đăng ký của tôi
          </Link>
        </div>
        {feed.isPending && (
          <output className="block text-sm text-neutral-500 dark:text-neutral-400">
            Đang tải hoạt động…
          </output>
        )}
        {feed.isError && <ErrorBanner error={feed.error} />}
        {feed.isSuccess &&
          (feed.data.activities.length === 0 ? (
            <EmptyState
              icon={FiCalendar}
              title="Chưa có hoạt động sắp tới"
              hint="Khi tổ chức của bạn công bố hoạt động mới, nó sẽ hiện ở đây."
            />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {feed.data.activities.map((item) => (
                <FeedCard key={item.activity.id} item={item} />
              ))}
            </ul>
          ))}
      </section>

      <section aria-labelledby="my-orgs" className="flex flex-col gap-4">
        <h2 id="my-orgs" className="text-lg font-semibold">
          Tổ chức của tôi
        </h2>

        {me.isPending && (
          <output className="block text-sm text-neutral-500 dark:text-neutral-400">
            Đang tải tổ chức…
          </output>
        )}

        {me.isError && <ErrorBanner error={me.error} />}

        {me.isSuccess &&
          (me.data.memberships.length === 0 ? (
            <EmptyState
              icon={FiUserPlus}
              title="Bạn chưa thuộc tổ chức nào"
              hint="Tạo tổ chức mới cho Đoàn – Hội của bạn, hoặc tham gia bằng mã mời."
            />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {me.data.memberships.map((membership) => (
                <MembershipCard
                  key={membership.member_id}
                  membership={membership}
                />
              ))}
            </ul>
          ))}

        <div className="flex flex-wrap gap-3">
          <Link
            href="/orgs/new"
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-800 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            <FiPlus aria-hidden="true" className="h-4 w-4" />
            Tạo tổ chức
          </Link>
          <Link
            href="/orgs/join"
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-800 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            <FiUserPlus aria-hidden="true" className="h-4 w-4" />
            Tham gia bằng mã
          </Link>
        </div>
      </section>

      <SpeculationRules prefetch={["/orgs/new", "/orgs/join"]} />
    </div>
  );
}
