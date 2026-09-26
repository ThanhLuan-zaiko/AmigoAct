/**
 * Phase-6 contract types — volunteer records, the org roster and reports.
 *
 * These live in their own module only because `lib/types.ts` reached the
 * repo's 350-line ceiling; `types.ts` re-exports everything here so
 * `@/lib/types` stays the single import site. Same rules apply: shapes
 * mirror `backend/src/backend/api/` serializers field for field, datetimes
 * are ISO 8601 strings, and `number | string` money-like fields must be
 * normalized through `Number()` before arithmetic.
 *
 * Framework-free: no `next/*` or React imports.
 */
import type {
  ActivityStatus,
  MemberRole,
  MemberStatus,
  OrgSummary,
} from "@/lib/types";

/** A volunteer record — hours/points awarded to a member (`RecordOut`). */
export interface VolunteerRecord {
  id: string;
  member_id: string;
  /** Owning activity — `null` for manually recorded achievements. */
  activity_id: string | null;
  registration_id: string | null;
  title: string;
  hours: number | string | null;
  points: number | string;
  /** `YYYY-MM-DD`. */
  awarded_on: string;
  note: string | null;
  evidence_url: string | null;
  recorded_by: string | null;
  created_at: string;
}

/** The activity summary embedded in a `GET /api/me/records` row. */
export interface RecordActivity {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  status: ActivityStatus;
}

/** One row of `GET /api/me/records`. */
export interface MyRecordItem {
  record: VolunteerRecord;
  activity: RecordActivity | null;
  org: OrgSummary;
}

/** Totals block of `GET /api/me/records`. */
export interface MyRecordsTotals {
  hours: number | string;
  points: number | string;
}

/** One org bucket of the `by_org` breakdown. */
export interface MyRecordsOrgTotal {
  org: OrgSummary;
  hours: number | string;
  points: number | string;
}

/** `GET /api/me/records` response body. */
export interface MyRecords {
  totals: MyRecordsTotals;
  by_org: MyRecordsOrgTotal[];
  records: MyRecordItem[];
}

/** One row of `GET /api/orgs/{id}/members` (manager+). */
export interface MemberRow {
  member_id: string;
  user_id: string;
  email: string;
  /** Roster display name — may differ from the account name. */
  full_name: string;
  role: MemberRole;
  status: MemberStatus;
  student_code: string | null;
  class_name: string | null;
  faculty: string | null;
  joined_at: string;
  total_hours: number | string;
  total_points: number | string;
}

/** `GET /api/orgs/{id}/members` response body. */
export interface OrgMembers {
  members: MemberRow[];
}

/** The member header block of `MemberRecords` (manager view). */
export interface MemberRecordsMember {
  member_id: string;
  full_name: string;
  student_code: string | null;
  class_name: string | null;
  faculty: string | null;
  email: string;
}

/** `GET /api/orgs/{id}/members/{mid}/records` response body (manager+). */
export interface MemberRecords {
  member: MemberRecordsMember;
  records: VolunteerRecord[];
}

/** Totals block of `GET /api/orgs/{id}/reports/overview`. */
export interface ReportTotals {
  activities: number;
  published: number;
  completed: number;
  cancelled: number;
  registrations: number;
  approved: number;
  checked_in: number;
  /** Check-in share of approved registrations, as a 0–1 ratio. */
  checkin_rate: number | string;
  total_hours: number | string;
  total_points: number | string;
}

/** One monthly bucket of the overview report. */
export interface ReportMonth {
  /** `YYYY-MM`. */
  month: string;
  activities: number;
  registrations: number;
  hours: number | string;
}

/** One faculty row of the overview report. */
export interface FacultyReport {
  faculty: string | null;
  members: number;
  hours: number | string;
  points: number | string;
}

/** One top-volunteer row of the overview report. */
export interface TopVolunteer {
  member_id: string;
  full_name: string;
  student_code: string | null;
  faculty: string | null;
  hours: number | string;
  points: number | string;
  record_count: number;
}

/** `GET /api/orgs/{id}/reports/overview` response body. */
export interface ReportsOverview {
  totals: ReportTotals;
  monthly: ReportMonth[];
  by_faculty: FacultyReport[];
  top_volunteers: TopVolunteer[];
}

/** One row of `GET /api/orgs/{id}/reports/activities`. */
export interface ActivityReportRow {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  status: ActivityStatus;
  capacity: number | null;
  registered: number;
  approved: number;
  checked_in: number;
  hours_awarded: number | string;
  points_awarded: number | string;
}

/** `GET /api/orgs/{id}/reports/activities` response body. */
export interface ActivitiesReport {
  activities: ActivityReportRow[];
}
