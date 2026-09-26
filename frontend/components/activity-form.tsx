"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { ErrorBanner } from "@/components/error-banner";
import { InputField, TextareaField } from "@/components/field";
import { buildActivityPayload } from "@/lib/activity-form";
import { ApiError, apiFetch } from "@/lib/api";
import { describeApiError } from "@/lib/errors";
import { isoToDatetimeLocal } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import type { Activity } from "@/lib/types";

/**
 * Shared create/edit form for activities.
 *
 * Create mode (`orgId`) POSTs to `/api/orgs/{orgId}/activities`; edit mode
 * (`activity`) PATCHes `/api/activities/{id}` with the full field set —
 * emptied optional fields are sent as `null` so they clear. Validation and
 * payload assembly live in `lib/activity-form.ts`.
 */
export function ActivityForm({
  orgId,
  activity,
}: {
  /** Create mode: the org that owns the new activity. */
  orgId?: string;
  /** Edit mode: the activity being edited (prefills every field). */
  activity?: Activity;
}) {
  const router = useRouter();
  const { token, status } = useAuth();
  const queryClient = useQueryClient();
  const editing = activity !== undefined;

  const [title, setTitle] = useState(activity?.title ?? "");
  const [description, setDescription] = useState(activity?.description ?? "");
  const [location, setLocation] = useState(activity?.location ?? "");
  const [capacity, setCapacity] = useState(
    activity?.capacity == null ? "" : String(activity.capacity),
  );
  const [points, setPoints] = useState(
    activity === undefined ? "" : String(Number(activity.points)),
  );
  const [hours, setHours] = useState(
    activity === undefined ? "" : String(Number(activity.hours)),
  );
  const [regOpens, setRegOpens] = useState(
    activity?.registration_opens_at
      ? (isoToDatetimeLocal(activity.registration_opens_at) ?? "")
      : "",
  );
  const [regCloses, setRegCloses] = useState(
    activity?.registration_closes_at
      ? (isoToDatetimeLocal(activity.registration_closes_at) ?? "")
      : "",
  );
  const [startsAt, setStartsAt] = useState(
    activity ? (isoToDatetimeLocal(activity.starts_at) ?? "") : "",
  );
  const [endsAt, setEndsAt] = useState(
    activity ? (isoToDatetimeLocal(activity.ends_at) ?? "") : "",
  );
  const [capacityError, setCapacityError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editing
        ? apiFetch<{ activity: Activity }>(`/api/activities/${activity.id}`, {
            method: "PATCH",
            body,
            token: token ?? undefined,
          })
        : apiFetch<{ activity: Activity }>(
            `/api/orgs/${orgId ?? ""}/activities`,
            { method: "POST", body, token: token ?? undefined },
          ),
    onSuccess: (data) => {
      const id = editing ? activity.id : data.activity.id;
      void queryClient.invalidateQueries({ queryKey: qk.activity(id) });
      void queryClient.invalidateQueries({
        queryKey: qk.orgActivities(data.activity.org_id),
      });
      router.push(`/activities/${id}`);
    },
    onError: (mutationError: unknown) => {
      if (
        mutationError instanceof ApiError &&
        mutationError.code === "capacity_below_registrations"
      ) {
        setCapacityError(describeApiError(mutationError));
        return;
      }
      setError(describeApiError(mutationError));
    },
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setCapacityError(null);
    const result = buildActivityPayload(
      {
        title,
        description,
        location,
        capacity,
        points,
        hours,
        registrationOpens: regOpens,
        registrationCloses: regCloses,
        startsAt,
        endsAt,
      },
      editing ? "edit" : "create",
    );
    if (result.error !== undefined) {
      setError(result.error);
      return;
    }
    if (result.capacityError !== undefined) {
      setCapacityError(result.capacityError);
      return;
    }
    save.mutate(result.body ?? {});
  };

  const numberProps = {
    type: "number",
    min: 0,
    step: 0.5,
    required: true,
    inputMode: "decimal",
  } as const;
  const datetimeProps = { type: "datetime-local", required: true } as const;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <InputField
        label="Tên hoạt động"
        name="title"
        required
        maxLength={200}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <TextareaField
        label="Mô tả"
        name="description"
        rows={3}
        maxLength={4000}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      <InputField
        label="Địa điểm"
        name="location"
        maxLength={200}
        value={location}
        onChange={(event) => setLocation(event.target.value)}
      />
      <InputField
        label="Sức chứa"
        hint="Để trống nếu không giới hạn."
        error={capacityError}
        type="number"
        name="capacity"
        min={1}
        step={1}
        inputMode="numeric"
        value={capacity}
        onChange={(event) => setCapacity(event.target.value)}
      />
      <div className="grid grid-cols-2 gap-3">
        <InputField
          label="Giờ tình nguyện"
          name="hours"
          value={hours}
          onChange={(event) => setHours(event.target.value)}
          {...numberProps}
        />
        <InputField
          label="Điểm"
          name="points"
          value={points}
          onChange={(event) => setPoints(event.target.value)}
          {...numberProps}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <InputField
          label="Bắt đầu"
          name="starts_at"
          value={startsAt}
          onChange={(event) => setStartsAt(event.target.value)}
          {...datetimeProps}
        />
        <InputField
          label="Kết thúc"
          name="ends_at"
          value={endsAt}
          onChange={(event) => setEndsAt(event.target.value)}
          {...datetimeProps}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <InputField
          label="Mở đăng ký"
          hint="Không bắt buộc."
          type="datetime-local"
          name="registration_opens_at"
          value={regOpens}
          onChange={(event) => setRegOpens(event.target.value)}
        />
        <InputField
          label="Đóng đăng ký"
          hint="Không bắt buộc."
          type="datetime-local"
          name="registration_closes_at"
          value={regCloses}
          onChange={(event) => setRegCloses(event.target.value)}
        />
      </div>

      <ErrorBanner error={error} />

      <button
        type="submit"
        disabled={status === "loading" || save.isPending}
        className="rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
      >
        {save.isPending
          ? "Đang lưu…"
          : editing
            ? "Lưu thay đổi"
            : "Tạo hoạt động"}
      </button>
    </form>
  );
}
