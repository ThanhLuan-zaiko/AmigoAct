/**
 * Vietnamese display labels for the frozen contract vocabularies.
 *
 * Contract values (`ActivityStatus`, `RegistrationStatus`, `MemberRole`)
 * stay English in code and on the wire; these maps are the single place
 * they are translated for the UI — pinned by `tests/regression/`.
 *
 * Framework-free: no `next/*` or React imports.
 */
import type {
  ActivityStatus,
  MemberRole,
  MemberStatus,
  RegistrationStatus,
} from "@/lib/types";

/** Every activity status, in contract order (draft → terminal states). */
export const ACTIVITY_STATUSES = [
  "draft",
  "published",
  "cancelled",
  "completed",
] as const satisfies readonly ActivityStatus[];

/** Every registration status. */
export const REGISTRATION_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
] as const satisfies readonly RegistrationStatus[];

export const ACTIVITY_STATUS_LABELS: Record<ActivityStatus, string> = {
  draft: "Bản nháp",
  published: "Đã công bố",
  cancelled: "Đã hủy",
  completed: "Đã hoàn thành",
};

export const REGISTRATION_STATUS_LABELS: Record<RegistrationStatus, string> = {
  pending: "Chờ duyệt",
  approved: "Đã duyệt",
  rejected: "Đã từ chối",
  cancelled: "Đã hủy",
};

export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  admin: "Quản trị",
  manager: "Ban chấp hành",
  member: "Đoàn viên",
};

/** Every membership status. */
export const MEMBER_STATUSES = [
  "active",
  "inactive",
] as const satisfies readonly MemberStatus[];

export const MEMBER_STATUS_LABELS: Record<MemberStatus, string> = {
  active: "Hoạt động",
  inactive: "Ngừng",
};

/**
 * Role rank for demotion checks — a lower number is a stronger role, so
 * `ROLE_RANK[next] > ROLE_RANK[current]` means the change loses powers.
 */
export const ROLE_RANK: Record<MemberRole, number> = {
  admin: 0,
  manager: 1,
  member: 2,
};

/** Statuses that can appear on a status chip, labelled. */
const STATUS_LABELS: Record<ActivityStatus | RegistrationStatus, string> = {
  ...ACTIVITY_STATUS_LABELS,
  ...REGISTRATION_STATUS_LABELS,
};

/**
 * Label for any contract status value. Falls back to the raw value rather
 * than hiding an unknown state — but every contract status has an entry.
 */
export function statusLabel(
  status: ActivityStatus | RegistrationStatus,
): string {
  return STATUS_LABELS[status];
}

/** Whether the role may manage activities (create, publish, review…). */
export function isManagerRole(role: MemberRole): boolean {
  return role === "manager" || role === "admin";
}
