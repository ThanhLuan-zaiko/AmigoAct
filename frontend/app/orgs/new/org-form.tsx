"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { ErrorBanner } from "@/components/error-banner";
import { InputField, TextareaField } from "@/components/field";
import { ApiError, apiFetch } from "@/lib/api";
import { describeApiError } from "@/lib/errors";
import type { OrgMutationResponse } from "@/lib/types";

/**
 * Org create form — `POST /api/orgs`.
 *
 * `org_code_taken` lands on the code field (it is the field to fix); every
 * other error surfaces as a banner. Success routes to the new org's page.
 */
export function OrgForm() {
  const router = useRouter();
  const { token, status } = useAuth();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: Record<string, string>) =>
      apiFetch<OrgMutationResponse>("/api/orgs", {
        method: "POST",
        body,
        token: token ?? undefined,
      }),
    onSuccess: (data) => router.push(`/orgs/${data.org.id}`),
    onError: (mutationError: unknown) => {
      if (
        mutationError instanceof ApiError &&
        mutationError.code === "org_code_taken"
      ) {
        setCodeError(describeApiError(mutationError));
        return;
      }
      setError(describeApiError(mutationError));
    },
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setCodeError(null);
    const body: Record<string, string> = {
      code: code.trim(),
      name: name.trim(),
    };
    if (description.trim() !== "") {
      body.description = description.trim();
    }
    if (contactEmail.trim() !== "") {
      body.contact_email = contactEmail.trim();
    }
    create.mutate(body);
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Tạo tổ chức</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Tạo tổ chức cho Đoàn – Hội của bạn. Bạn sẽ là quản trị viên đầu tiên.
        </p>
      </header>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <InputField
          label="Mã tổ chức"
          hint="Mã ngắn để thành viên tham gia, ví dụ CLB-TN."
          error={codeError}
          type="text"
          name="code"
          required
          maxLength={32}
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
        <InputField
          label="Tên tổ chức"
          type="text"
          name="name"
          required
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <TextareaField
          label="Mô tả"
          name="description"
          rows={3}
          maxLength={2000}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <InputField
          label="Email liên hệ"
          type="email"
          name="contact_email"
          value={contactEmail}
          onChange={(event) => setContactEmail(event.target.value)}
        />

        <ErrorBanner error={error} />

        <button
          type="submit"
          disabled={status === "loading" || create.isPending}
          className="rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {create.isPending ? "Đang tạo…" : "Tạo tổ chức"}
        </button>
      </form>
    </div>
  );
}
