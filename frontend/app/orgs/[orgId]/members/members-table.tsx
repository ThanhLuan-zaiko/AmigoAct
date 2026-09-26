"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FiUsers } from "react-icons/fi";

import { useAuth } from "@/components/auth-provider";
import { EmptyState } from "@/components/empty-state";
import { ErrorBanner } from "@/components/error-banner";
import { apiFetch } from "@/lib/api";
import { ROLE_RANK } from "@/lib/labels";
import { qk } from "@/lib/query-keys";
import type {
  MemberRole,
  MemberRow,
  MemberStatus,
  MembershipResponse,
} from "@/lib/types";

import { type Demotion, MemberRowItem } from "./member-row";
import { SelfProfileForm } from "./self-profile-form";

interface PatchVars {
  memberId: string;
  body: { role?: MemberRole; status?: MemberStatus };
}

/**
 * The roster table: read-only for managers, editable for admins.
 *
 * Admin actions on each row: a role `<select>` (promotions apply directly,
 * demotions are held in `pendingDemotion` and confirmed inline) and a
 * status toggle. `last_admin` and the other contract errors surface in the
 * banner above the table. The self row can open the profile editor, which
 * renders below the table while active.
 */
export function MembersTable({
  orgId,
  members,
  selfMemberId,
  canAdmin,
}: {
  orgId: string;
  members: MemberRow[];
  /** The caller's own `member_id` — marks the self-editable row. */
  selfMemberId: string;
  canAdmin: boolean;
}) {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const [editingSelf, setEditingSelf] = useState(false);
  const [pendingDemotion, setPendingDemotion] = useState<Demotion | null>(null);

  const update = useMutation({
    mutationFn: ({ memberId, body }: PatchVars) =>
      apiFetch<MembershipResponse>(`/api/orgs/${orgId}/members/${memberId}`, {
        method: "PATCH",
        body,
        token: token ?? undefined,
      }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: qk.orgMembers(orgId) });
    },
    onError: setError,
  });

  const pickRole = (row: MemberRow, next: MemberRole) => {
    if (next === row.role || update.isPending) {
      return;
    }
    if (ROLE_RANK[next] > ROLE_RANK[row.role]) {
      // Demotion loses powers — hold it behind the inline confirm.
      setPendingDemotion({ memberId: row.member_id, role: next });
      return;
    }
    update.mutate({ memberId: row.member_id, body: { role: next } });
  };

  const toggleStatus = (row: MemberRow, next: MemberStatus) => {
    update.mutate({ memberId: row.member_id, body: { status: next } });
  };

  if (members.length === 0) {
    return <EmptyState icon={FiUsers} title="Chưa có thành viên" />;
  }

  const self = members.find((row) => row.member_id === selfMemberId);

  return (
    <section
      aria-label="Danh sách thành viên"
      className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <ErrorBanner error={error} />
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
              <th className="py-2 pr-4 font-medium">Thành viên</th>
              <th className="py-2 pr-4 font-medium">MSSV / Lớp / Khoa</th>
              <th className="py-2 pr-4 font-medium">Vai trò</th>
              <th className="py-2 pr-4 font-medium">Trạng thái</th>
              <th className="py-2 pr-4 font-medium">Giờ / Điểm</th>
              <th className="py-2 pr-4 font-medium">Tham gia</th>
              <th className="py-2 font-medium">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {members.map((row) => (
              <MemberRowItem
                key={row.member_id}
                orgId={orgId}
                row={row}
                isSelf={row.member_id === selfMemberId}
                canAdmin={canAdmin}
                busy={update.isPending}
                pendingDemotion={
                  pendingDemotion?.memberId === row.member_id
                    ? pendingDemotion
                    : null
                }
                onPickRole={pickRole}
                onConfirmDemotion={() => {
                  if (pendingDemotion === null) {
                    return;
                  }
                  setPendingDemotion(null);
                  update.mutate({
                    memberId: pendingDemotion.memberId,
                    body: { role: pendingDemotion.role },
                  });
                }}
                onCancelDemotion={() => setPendingDemotion(null)}
                onToggleStatus={toggleStatus}
                onEditSelf={() => setEditingSelf((value) => !value)}
              />
            ))}
          </tbody>
        </table>
      </div>
      {editingSelf && self !== undefined && (
        <SelfProfileForm
          orgId={orgId}
          member={self}
          onDone={() => setEditingSelf(false)}
        />
      )}
    </section>
  );
}
