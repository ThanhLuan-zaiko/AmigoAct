"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { FiLock, FiPlus } from "react-icons/fi";

import { useAuth } from "@/components/auth-provider";
import { EmptyState } from "@/components/empty-state";
import { ErrorBanner } from "@/components/error-banner";
import { apiFetch } from "@/lib/api";
import { isManagerRole } from "@/lib/labels";
import { qk } from "@/lib/query-keys";
import type {
  MemberRecords,
  OrgDetailResponse,
  VolunteerRecord,
} from "@/lib/types";

import { RecordForm, type RecordFormValues } from "./record-form";
import { RecordsTable } from "./records-table";

/**
 * `/orgs/[orgId]/members/[memberId]/records` — the manager's record book
 * for one member: a header with the member's profile, a "Ghi nhận thành
 * tích" create form and the records table with edit/delete/certificate
 * actions. Manager+ only, gated like the roster page.
 */
export function MemberRecordsView({
  orgId,
  memberId,
}: {
  orgId: string;
  memberId: string;
}) {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<unknown>(null);

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

  const data = useQuery({
    queryKey: qk.memberRecords(orgId, memberId),
    queryFn: ({ signal }) =>
      apiFetch<MemberRecords>(
        `/api/orgs/${orgId}/members/${memberId}/records`,
        { token: token ?? undefined, signal },
      ),
    enabled: token !== null && manager,
  });

  const create = useMutation({
    mutationFn: (values: RecordFormValues) =>
      apiFetch<{ record: VolunteerRecord }>(
        `/api/orgs/${orgId}/members/${memberId}/records`,
        { method: "POST", body: values, token: token ?? undefined },
      ),
    onSuccess: () => {
      setCreateError(null);
      setCreating(false);
      void queryClient.invalidateQueries({
        queryKey: qk.memberRecords(orgId),
      });
      void queryClient.invalidateQueries({ queryKey: qk.orgMembers(orgId) });
      void queryClient.invalidateQueries({ queryKey: qk.reports(orgId) });
    },
    onError: setCreateError,
  });

  if (org.isPending || (manager && data.isPending)) {
    return (
      <output className="block px-4 py-16 text-center text-sm text-neutral-500 dark:text-neutral-400">
        Đang tải thành tích…
      </output>
    );
  }
  if (org.isError || data.isError) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16">
        <ErrorBanner error={org.error ?? data.error} />
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
          hint="Chỉ ban chấp hành hoặc quản trị viên mới quản lý được thành tích."
          action={{ href: `/orgs/${orgId}`, label: "Về trang tổ chức" }}
        />
      </div>
    );
  }

  const { member, records } = data.data ?? {
    member: null,
    records: [],
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">
            {member?.full_name ?? "Thành tích"}
          </h1>
        </div>
        {member !== null && (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            {[
              member.student_code && `MSSV: ${member.student_code}`,
              member.class_name,
              member.faculty,
              member.email,
            ]
              .filter((part): part is string => !!part)
              .join(" · ")}
          </p>
        )}
        <nav
          aria-label="Quản lý thành viên"
          className="flex flex-wrap gap-2 text-sm"
        >
          <Link
            href={`/orgs/${orgId}/members`}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            Danh sách thành viên
          </Link>
          <button
            type="button"
            onClick={() => setCreating((value) => !value)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
          >
            <FiPlus aria-hidden="true" className="h-4 w-4" />
            Ghi nhận thành tích
          </button>
        </nav>
      </header>

      {creating && (
        <section
          aria-label="Ghi nhận thành tích"
          className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
        >
          <RecordForm
            pending={create.isPending}
            submitLabel="Ghi nhận"
            onSubmit={(values) => create.mutate(values)}
            onCancel={() => setCreating(false)}
          />
          <div className="mt-3">
            <ErrorBanner error={createError} />
          </div>
        </section>
      )}

      {data.isSuccess && <RecordsTable orgId={orgId} records={records} />}
    </div>
  );
}
