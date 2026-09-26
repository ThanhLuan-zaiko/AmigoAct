"use client";

import { type FormEvent, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { InputField, TextareaField } from "@/components/field";
import { todayDateInput } from "@/lib/format";
import type { VolunteerRecord } from "@/lib/types";

/** The values a record form produces — matches the POST/PATCH bodies. */
export interface RecordFormValues {
  title: string;
  /** `null` means "không ghi giờ" — the field is optional. */
  hours: number | null;
  points: number;
  /** `YYYY-MM-DD`. */
  awarded_on: string;
  note: string | null;
  evidence_url: string | null;
}

interface FieldErrors {
  title?: string;
  hours?: string;
  points?: string;
  awarded_on?: string;
}

/** `Number()` that accepts the vi-VN decimal comma; `null` when invalid. */
function parseAmount(raw: string): number | null {
  if (raw.trim() === "") {
    return null;
  }
  const value = Number(raw.trim().replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Shared create/edit form for volunteer records. All client validation is
 * a convenience — the server still validates (`future_awarded_on`,
 * `invalid_evidence_url`, …) and its errors surface above the form.
 */
export function RecordForm({
  initial,
  pending,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  /** Seed values for editing; empty defaults to a fresh create form. */
  initial?: Partial<VolunteerRecord>;
  pending: boolean;
  submitLabel: string;
  onSubmit: (values: RecordFormValues) => void;
  onCancel?: () => void;
}) {
  const { status } = useAuth();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [hours, setHours] = useState(
    initial?.hours !== null && initial?.hours !== undefined
      ? String(initial.hours)
      : "",
  );
  const [points, setPoints] = useState(
    initial?.points !== undefined ? String(initial.points) : "",
  );
  const [awardedOn, setAwardedOn] = useState(
    initial?.awarded_on ?? todayDateInput(),
  );
  const [note, setNote] = useState(initial?.note ?? "");
  const [evidenceUrl, setEvidenceUrl] = useState(initial?.evidence_url ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next: FieldErrors = {};
    const cleanTitle = title.trim();
    if (cleanTitle === "") {
      next.title = "Nhập tên thành tích";
    }
    const hoursValue = hours.trim() === "" ? null : parseAmount(hours);
    if (hours.trim() !== "" && (hoursValue === null || hoursValue < 0)) {
      next.hours = "Số giờ không hợp lệ";
    }
    const pointsValue = parseAmount(points);
    if (pointsValue === null || pointsValue < 0) {
      next.points = "Điểm không hợp lệ";
    }
    if (!DAY_RE.test(awardedOn)) {
      next.awarded_on = "Ngày ghi nhận không hợp lệ";
    }
    setErrors(next);
    if (Object.keys(next).length > 0) {
      return;
    }
    onSubmit({
      title: cleanTitle,
      hours: hoursValue,
      points: pointsValue ?? 0,
      awarded_on: awardedOn,
      note: note.trim() === "" ? null : note.trim(),
      evidence_url: evidenceUrl.trim() === "" ? null : evidenceUrl.trim(),
    });
  };

  return (
    // noValidate — the Vietnamese field errors below replace the browser's
    // native bubbles, so `required` stays semantic-only (AT announcement).
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3">
      <InputField
        label="Tên thành tích"
        error={errors.title}
        type="text"
        name="title"
        required
        maxLength={200}
        placeholder="Ví dụ: Tham gia hiến máu"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <InputField
          label="Số giờ"
          hint="Không bắt buộc"
          error={errors.hours}
          type="text"
          name="hours"
          inputMode="decimal"
          placeholder="4"
          value={hours}
          onChange={(event) => setHours(event.target.value)}
        />
        <InputField
          label="Điểm"
          error={errors.points}
          type="text"
          name="points"
          required
          inputMode="decimal"
          placeholder="2"
          value={points}
          onChange={(event) => setPoints(event.target.value)}
        />
        <InputField
          label="Ngày ghi nhận"
          error={errors.awarded_on}
          type="date"
          name="awarded_on"
          required
          value={awardedOn}
          onChange={(event) => setAwardedOn(event.target.value)}
        />
      </div>
      <InputField
        label="Đường dẫn minh chứng"
        hint="Không bắt buộc — URL ảnh/tài liệu minh chứng"
        type="url"
        name="evidence_url"
        placeholder="https://…"
        value={evidenceUrl}
        onChange={(event) => setEvidenceUrl(event.target.value)}
      />
      <TextareaField
        label="Ghi chú"
        name="note"
        rows={2}
        maxLength={500}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={status === "loading" || pending}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {pending ? "Đang lưu…" : submitLabel}
        </button>
        {onCancel !== undefined && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            Hủy
          </button>
        )}
      </div>
    </form>
  );
}
