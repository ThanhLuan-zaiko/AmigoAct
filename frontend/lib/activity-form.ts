/**
 * Payload builder + client-side validation for the activity create/edit
 * form. Pure so it is unit-tested without rendering.
 *
 * `datetime-local` strings convert through `datetimeLocalToIso`. In
 * `"create"` mode empty optional fields are omitted from the body (the
 * contract marks them `?`); in `"edit"` mode they are sent as `null` so a
 * cleared field actually clears.
 *
 * Error strings are Vietnamese — they render directly as form feedback.
 *
 * Framework-free: no `next/*` or React imports.
 */
import { datetimeLocalToIso } from "@/lib/format";

/** Raw string values as held by the form's inputs. */
export interface ActivityFormFields {
  title: string;
  description: string;
  location: string;
  /** Empty string = unlimited capacity. */
  capacity: string;
  points: string;
  hours: string;
  registrationOpens: string;
  registrationCloses: string;
  startsAt: string;
  endsAt: string;
}

export interface ActivityPayloadResult {
  /** The request body — present only when `error`/`capacityError` are not. */
  body?: Record<string, unknown>;
  /** Banner-level validation error. */
  error?: string;
  /** Field-level error pinned to the capacity input. */
  capacityError?: string;
}

/**
 * Validate and build the POST/PATCH body. Returns exactly one of `body`,
 * `error` or `capacityError`.
 */
export function buildActivityPayload(
  fields: ActivityFormFields,
  mode: "create" | "edit",
): ActivityPayloadResult {
  const startsIso = datetimeLocalToIso(fields.startsAt);
  const endsIso = datetimeLocalToIso(fields.endsAt);
  if (startsIso === null || endsIso === null) {
    return { error: "Thời gian không hợp lệ" };
  }
  if (endsIso <= startsIso) {
    return { error: "Thời gian kết thúc phải sau thời gian bắt đầu" };
  }

  const points = Number(fields.points);
  const hours = Number(fields.hours);
  if (
    !Number.isFinite(points) ||
    points < 0 ||
    !Number.isFinite(hours) ||
    hours < 0
  ) {
    return { error: "Điểm và giờ tình nguyện phải là số không âm" };
  }

  const capacity =
    fields.capacity.trim() === "" ? null : Number(fields.capacity.trim());
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1)) {
    return { capacityError: "Sức chứa phải là số nguyên từ 1 trở lên" };
  }

  const optionalIso = (value: string): string | null | undefined => {
    if (value.trim() === "") {
      return null;
    }
    const iso = datetimeLocalToIso(value);
    return iso === null ? undefined : iso;
  };
  const regOpens = optionalIso(fields.registrationOpens);
  const regCloses = optionalIso(fields.registrationCloses);
  if (regOpens === undefined || regCloses === undefined) {
    return { error: "Thời gian đăng ký không hợp lệ" };
  }
  if (regOpens !== null && regCloses !== null && regCloses <= regOpens) {
    return { error: "Thời gian đóng đăng ký phải sau thời gian mở" };
  }

  const textOrNull = (value: string) =>
    value.trim() === "" ? null : value.trim();

  const body: Record<string, unknown> = {
    title: fields.title.trim(),
    points,
    hours,
    starts_at: startsIso,
    ends_at: endsIso,
  };

  // Optional fields: null clears them in edit mode; create omits them
  // entirely so the contract's `?` semantics are respected.
  const optionals: Record<string, unknown> = {
    description: textOrNull(fields.description),
    location: textOrNull(fields.location),
    capacity,
    registration_opens_at: regOpens,
    registration_closes_at: regCloses,
  };
  for (const [key, value] of Object.entries(optionals)) {
    if (mode === "edit" || value !== null) {
      body[key] = value;
    }
  }
  return { body };
}
