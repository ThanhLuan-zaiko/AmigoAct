/**
 * TypeScript mirrors of the frozen backend API contract.
 *
 * These shapes match `backend/src/backend/api/` serializers field for field —
 * the regression suite in `tests/regression/` pins the parts that must never
 * drift. Datetimes are ISO 8601 UTC strings; ids are UUID strings.
 *
 * Framework-free: no `next/*` or React imports.
 */

/** Membership role inside an organisation. */
export type MemberRole = "member" | "manager" | "admin";

/** Whether a membership currently counts. */
export type MemberStatus = "active" | "inactive";

/** An account as returned by `/api/auth/*`. */
export interface User {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  is_active: boolean;
  created_at: string;
}

/** The organisation summary embedded in a membership. */
export interface OrgSummary {
  id: string;
  code: string;
  name: string;
}

/** One row of the caller's membership list. */
export interface Membership {
  member_id: string;
  org_id: string;
  /** Roster display name — may differ from the account name. */
  full_name: string;
  role: MemberRole;
  status: MemberStatus;
  student_code: string | null;
  class_name: string | null;
  faculty: string | null;
  joined_at: string;
  org: OrgSummary;
}

/** `POST /api/auth/register` and `/api/auth/login` response body. */
export interface AuthResponse {
  access_token: string;
  token_type: "bearer";
  user: User;
}

/** `GET /api/auth/me` response body. */
export interface MeResponse {
  user: User;
  memberships: Membership[];
}

/** Lifecycle states of an activity — frozen contract values. */
export type ActivityStatus = "draft" | "published" | "cancelled" | "completed";

/** Lifecycle states of a registration — frozen contract values. */
export type RegistrationStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled";

/** An organisation as returned by the org endpoints. */
export interface Org {
  id: string;
  code: string;
  name: string;
  description: string | null;
  contact_email: string | null;
  is_active: boolean;
  created_at: string;
}

/** The caller's membership block inside the org detail response. */
export interface OrgMembership {
  member_id: string;
  /** Roster display name — may differ from the account name. */
  full_name: string;
  role: MemberRole;
  status: MemberStatus;
  student_code: string | null;
  class_name: string | null;
  faculty: string | null;
  joined_at: string;
}

/** `GET /api/orgs/{id}` stats block — real counts, never placeholders. */
export interface OrgStats {
  member_count: number;
  activity_count: number;
  upcoming_count: number;
}

/** `GET /api/orgs/{id}` response body. */
export interface OrgDetailResponse {
  org: Org;
  membership: OrgMembership;
  stats: OrgStats;
}

/** `POST /api/orgs` and `POST /api/orgs/join` response body (201). */
export interface OrgMutationResponse {
  org: Org;
  membership: OrgMembership;
}

/** `PATCH /api/orgs/{id}/members/{mid}` and `…/members/me` response body. */
export interface MembershipResponse {
  membership: OrgMembership;
}

/**
 * An activity. `points`/`hours` are JSON numbers-or-strings by contract —
 * always normalize through `Number()` before arithmetic or formatting.
 */
export interface Activity {
  id: string;
  org_id: string;
  title: string;
  description: string | null;
  location: string | null;
  status: ActivityStatus;
  capacity: number | null;
  points: number | string;
  hours: number | string;
  registration_opens_at: string | null;
  registration_closes_at: string | null;
  starts_at: string;
  ends_at: string;
  created_at: string;
}

/** One row of an org's activity list. */
export interface ActivityListItem {
  activity: Activity;
  registered: number;
  checked_in: number;
}

/** `GET /api/orgs/{id}/activities` response body. */
export interface OrgActivitiesResponse {
  activities: ActivityListItem[];
}

/** A registration on an activity. */
export interface Registration {
  id: string;
  activity_id: string;
  member_id: string;
  status: RegistrationStatus;
  note: string | null;
  checked_in_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

/** `GET /api/activities/{id}` response body. */
export interface ActivityDetailResponse {
  activity: Activity;
  registered: number;
  checked_in: number;
  my_registration: Registration | null;
  /** Present only for managers; `null` when no code is set. */
  checkin_code: string | null;
}

/** Member info embedded in the manager's registrations list. */
export interface RegistrantMember {
  member_id: string;
  full_name: string;
  student_code: string | null;
  class_name: string | null;
  faculty: string | null;
  email: string;
}

/** `GET /api/activities/{id}/registrations` row. */
export interface RegistrationRow {
  registration: Registration;
  member: RegistrantMember;
}

/** `GET /api/activities/{id}/registrations` response body. */
export interface RegistrationsResponse {
  registrations: RegistrationRow[];
}

/** `POST /api/activities/{id}/checkin` and manual check-in response. */
export interface CheckinResponse {
  registration: Registration;
  already_checked_in: boolean;
  checked_in_count: number;
}

/** `POST /api/activities/{id}/checkin-code` response body. */
export interface CheckinCodeResponse {
  code: string;
  rotated: boolean;
}

/** `POST /api/activities/{id}/complete` response body. */
export interface CompleteResponse {
  activity: Activity;
  records_created: number;
}

/** One row of `GET /api/me/feed`. */
export interface FeedItem {
  activity: Activity;
  org: OrgSummary;
  my_registration_status: RegistrationStatus | null;
  registered: number;
}

/** `GET /api/me/feed` response body. */
export interface FeedResponse {
  activities: FeedItem[];
}

/** One row of `GET /api/me/registrations`. */
export interface MyRegistrationItem {
  registration: Registration;
  activity: {
    id: string;
    title: string;
    starts_at: string;
    ends_at: string;
    status: ActivityStatus;
  };
  org: OrgSummary;
}

/** `GET /api/me/registrations` response body. */
export interface MyRegistrationsResponse {
  registrations: MyRegistrationItem[];
}

// Phase-6 contract types (records, roster, reports) live in
// `lib/records-types.ts` — this file reached the repo's 350-line ceiling.
// The re-export keeps `@/lib/types` the single import site; that module
// only `import type`s back from here, so there is no runtime cycle.
export * from "@/lib/records-types";
