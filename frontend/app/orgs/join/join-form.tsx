"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { ErrorBanner } from "@/components/error-banner";
import { InputField } from "@/components/field";
import { ApiError, apiFetch } from "@/lib/api";
import { describeApiError } from "@/lib/errors";
import type { OrgMutationResponse } from "@/lib/types";

/**
 * Org join form — `POST /api/orgs/join` with the invite code plus optional
 * member profile fields (student code, class, faculty, display name).
 *
 * `org_not_found`/`invalid_org_code` land on the code field;
 * `student_code_taken` lands on its field; everything else is a banner.
 */
export function JoinForm() {
  const router = useRouter();
  const { token, status } = useAuth();
  const [code, setCode] = useState("");
  const [studentCode, setStudentCode] = useState("");
  const [className, setClassName] = useState("");
  const [faculty, setFaculty] = useState("");
  const [fullName, setFullName] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [studentCodeError, setStudentCodeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const join = useMutation({
    mutationFn: (body: Record<string, string>) =>
      apiFetch<OrgMutationResponse>("/api/orgs/join", {
        method: "POST",
        body,
        token: token ?? undefined,
      }),
    onSuccess: (data) => router.push(`/orgs/${data.org.id}`),
    onError: (mutationError: unknown) => {
      if (mutationError instanceof ApiError) {
        if (
          mutationError.code === "org_not_found" ||
          mutationError.code === "invalid_org_code"
        ) {
          setCodeError(describeApiError(mutationError));
          return;
        }
        if (mutationError.code === "student_code_taken") {
          setStudentCodeError(describeApiError(mutationError));
          return;
        }
      }
      setError(describeApiError(mutationError));
    },
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setCodeError(null);
    setStudentCodeError(null);
    const body: Record<string, string> = { code: code.trim() };
    const optional: Record<string, string> = {
      student_code: studentCode,
      class_name: className,
      faculty,
      full_name: fullName,
    };
    for (const [key, value] of Object.entries(optional)) {
      if (value.trim() !== "") {
        body[key] = value.trim();
      }
    }
    join.mutate(body);
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Tham gia tổ chức</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Nhập mã mời do ban quản lý tổ chức cung cấp.
        </p>
      </header>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <InputField
          label="Mã tham gia"
          error={codeError}
          type="text"
          name="code"
          required
          maxLength={32}
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
        <InputField
          label="Mã sinh viên"
          hint="Không bắt buộc — dùng để đối chiếu thành tích."
          error={studentCodeError}
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
        <InputField
          label="Họ và tên hiển thị"
          type="text"
          name="full_name"
          maxLength={120}
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
        />

        <ErrorBanner error={error} />

        <button
          type="submit"
          disabled={status === "loading" || join.isPending}
          className="rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {join.isPending ? "Đang tham gia…" : "Tham gia"}
        </button>
      </form>
    </div>
  );
}
