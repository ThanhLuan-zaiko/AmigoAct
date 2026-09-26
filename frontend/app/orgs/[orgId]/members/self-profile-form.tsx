"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { ErrorBanner } from "@/components/error-banner";
import { InputField } from "@/components/field";
import { apiFetch } from "@/lib/api";
import { describeApiError } from "@/lib/errors";
import { qk } from "@/lib/query-keys";
import type { MemberRow, MembershipResponse } from "@/lib/types";

/**
 * Inline editor for the caller's own roster profile —
 * `PATCH /api/orgs/{id}/members/me` with the four editable fields.
 *
 * Empty optional fields are sent as `null` so the member can clear them;
 * an empty `full_name` also falls back to `null` (the roster then shows
 * the account name). On success the roster, org detail and `/auth/me`
 * caches are invalidated so the fresh name shows everywhere.
 */
export function SelfProfileForm({
  orgId,
  member,
  onDone,
}: {
  orgId: string;
  member: MemberRow;
  onDone: () => void;
}) {
  const { token, status } = useAuth();
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState(member.full_name);
  const [studentCode, setStudentCode] = useState(member.student_code ?? "");
  const [className, setClassName] = useState(member.class_name ?? "");
  const [faculty, setFaculty] = useState(member.faculty ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: Record<string, string | null>) =>
      apiFetch<MembershipResponse>(`/api/orgs/${orgId}/members/me`, {
        method: "PATCH",
        body,
        token: token ?? undefined,
      }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: qk.orgMembers(orgId) });
      void queryClient.invalidateQueries({ queryKey: qk.orgs(orgId) });
      void queryClient.invalidateQueries({ queryKey: qk.me });
      onDone();
    },
    onError: (mutationError) => setError(describeApiError(mutationError)),
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const trimmed = (value: string) => {
      const clean = value.trim();
      return clean === "" ? null : clean;
    };
    save.mutate({
      full_name: trimmed(fullName),
      student_code: trimmed(studentCode),
      class_name: trimmed(className),
      faculty: trimmed(faculty),
    });
  };

  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4 sm:grid-cols-2 dark:border-neutral-800 dark:bg-neutral-950"
    >
      <InputField
        label="Họ và tên hiển thị"
        type="text"
        name="full_name"
        maxLength={120}
        value={fullName}
        onChange={(event) => setFullName(event.target.value)}
      />
      <InputField
        label="Mã sinh viên"
        type="text"
        name="student_code"
        maxLength={32}
        value={studentCode}
        onChange={(event) => setStudentCode(event.target.value)}
      />
      <InputField
        label="Lớp"
        type="text"
        name="class_name"
        maxLength={64}
        value={className}
        onChange={(event) => setClassName(event.target.value)}
      />
      <InputField
        label="Khoa"
        type="text"
        name="faculty"
        maxLength={120}
        value={faculty}
        onChange={(event) => setFaculty(event.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <button
          type="submit"
          disabled={status === "loading" || save.isPending}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {save.isPending ? "Đang lưu…" : "Lưu hồ sơ"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
        >
          Hủy
        </button>
      </div>
      <div className="sm:col-span-2">
        <ErrorBanner error={error} />
      </div>
    </form>
  );
}
