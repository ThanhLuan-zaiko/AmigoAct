"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { FiLock } from "react-icons/fi";

import { useAuth } from "@/components/auth-provider";
import { EmptyState } from "@/components/empty-state";
import { ErrorBanner } from "@/components/error-banner";
import { apiFetch } from "@/lib/api";
import { isManagerRole } from "@/lib/labels";
import { qk } from "@/lib/query-keys";
import type { OrgDetailResponse, OrgMembers } from "@/lib/types";

import { MembersTable } from "./members-table";

/**
 * `/orgs/[orgId]/members` — the org roster, visible to managers and admins.
 *
 * The gate reuses the org detail membership (same as the manage console):
 * non-managers get an honest lock screen instead of a 403 table. Admins
 * additionally get role/status actions; everyone sees "Chỉnh sửa hồ sơ" on
 * their own row and a "Thành tích" link to the member's record book.
 */
export function MembersView({ orgId }: { orgId: string }) {
  const { token } = useAuth();

  const org = useQuery({
    queryKey: qk.orgs(orgId),
    queryFn: ({ signal }) =>
      apiFetch<OrgDetailResponse>(`/api/orgs/${orgId}`, {
        token: token ?? undefined,
        signal,
      }),
    enabled: token !== null,
  });

  const manager = org.isSuccess && isManagerRole(org.data.membership.role);

  const members = useQuery({
    queryKey: qk.orgMembers(orgId),
    queryFn: ({ signal }) =>
      apiFetch<OrgMembers>(`/api/orgs/${orgId}/members`, {
        token: token ?? undefined,
        signal,
      }),
    enabled: token !== null && manager,
  });

  if (org.isPending || (manager && members.isPending)) {
    return (
      <output className="block px-4 py-16 text-center text-sm text-neutral-500 dark:text-neutral-400">
        Đang tải thành viên…
      </output>
    );
  }
  if (org.isError || members.isError) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16">
        <ErrorBanner error={org.error ?? members.error} />
      </div>
    );
  }
  if (!org.isSuccess) {
    return null;
  }

  if (!manager) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-16">
        <EmptyState
          icon={FiLock}
          title="Cần quyền quản lý"
          hint="Chỉ ban chấp hành hoặc quản trị viên mới xem được danh sách thành viên."
          action={{ href: `/orgs/${orgId}`, label: "Về trang tổ chức" }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Thành viên</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Danh sách thành viên của {org.data.org.name}.
        </p>
        <nav
          aria-label="Quản lý tổ chức"
          className="flex flex-wrap gap-2 text-sm"
        >
          <Link
            href={`/orgs/${orgId}`}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            Trang tổ chức
          </Link>
          <Link
            href={`/orgs/${orgId}/reports`}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            Báo cáo
          </Link>
        </nav>
      </header>

      {members.isSuccess && (
        <MembersTable
          orgId={orgId}
          members={members.data.members}
          selfMemberId={org.data.membership.member_id}
          canAdmin={org.data.membership.role === "admin"}
        />
      )}
    </div>
  );
}
