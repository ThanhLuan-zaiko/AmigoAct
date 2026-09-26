/**
 * Contract-shaped fixtures for integration tests. These are test data —
 * the "no mock data" rule applies to runtime code, not fixtures.
 */
import type {
  Activity,
  ActivityDetailResponse,
  ActivityReportRow,
  MemberRecords,
  MemberRecordsMember,
  MemberRole,
  MemberRow,
  MyRecordItem,
  MyRecords,
  MyRegistrationItem,
  Org,
  OrgDetailResponse,
  OrgMembership,
  Registration,
  RegistrationRow,
  RegistrationStatus,
  ReportsOverview,
  VolunteerRecord,
} from "@/lib/types";

export const ORG: Org = {
  id: "o-1",
  code: "CLB-TN",
  name: "CLB Tình nguyện",
  description: null,
  contact_email: null,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
};

export function membership(role: MemberRole = "member"): OrgMembership {
  return {
    member_id: "m-1",
    full_name: "Nguyễn Lan",
    role,
    status: "active",
    student_code: null,
    class_name: null,
    faculty: null,
    joined_at: "2026-01-02T00:00:00Z",
  };
}

export function orgDetail(
  role: MemberRole = "member",
  overrides: Partial<OrgDetailResponse> = {},
): OrgDetailResponse {
  return {
    org: ORG,
    membership: membership(role),
    stats: { member_count: 12, activity_count: 3, upcoming_count: 1 },
    ...overrides,
  };
}

export function activity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: "a-1",
    org_id: ORG.id,
    title: "Hiến máu tình nguyện",
    description: "Đợt hiến máu đầu hè",
    location: "Hội trường A",
    status: "published",
    capacity: 50,
    points: 2.5,
    hours: "4",
    registration_opens_at: null,
    registration_closes_at: null,
    starts_at: "2026-06-15T08:00:00.000Z",
    ends_at: "2026-06-15T17:00:00.000Z",
    created_at: "2026-05-01T00:00:00Z",
    ...overrides,
  };
}

export function registration(
  overrides: Partial<Registration> = {},
): Registration {
  return {
    id: "r-1",
    activity_id: "a-1",
    member_id: "m-1",
    status: "approved",
    note: null,
    checked_in_at: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

export function activityDetail(
  overrides: Partial<ActivityDetailResponse> = {},
): ActivityDetailResponse {
  return {
    activity: activity(),
    registered: 5,
    checked_in: 2,
    my_registration: null,
    checkin_code: null,
    ...overrides,
  };
}

export function regRow(
  status: RegistrationStatus = "pending",
  overrides: Partial<RegistrationRow> = {},
): RegistrationRow {
  return {
    registration: registration({ status }),
    member: {
      member_id: "m-9",
      full_name: "Trần Minh",
      student_code: "SV01",
      class_name: "CNTT01",
      faculty: null,
      email: "minh@example.com",
    },
    ...overrides,
  };
}

export function myRegItem(
  status: RegistrationStatus = "approved",
  overrides: Partial<MyRegistrationItem> = {},
): MyRegistrationItem {
  const act = activity();
  return {
    registration: registration({ status }),
    activity: {
      id: act.id,
      title: act.title,
      starts_at: act.starts_at,
      ends_at: act.ends_at,
      status: act.status,
    },
    org: { id: ORG.id, code: ORG.code, name: ORG.name },
    ...overrides,
  };
}

/* ---------- Phase 6: records, roster, reports ---------- */

export function record(
  overrides: Partial<VolunteerRecord> = {},
): VolunteerRecord {
  return {
    id: "rec-1",
    member_id: "m-1",
    activity_id: "a-1",
    registration_id: "r-1",
    title: "Hiến máu tình nguyện",
    hours: 4,
    points: 2.5,
    awarded_on: "2026-06-16",
    note: null,
    evidence_url: null,
    recorded_by: "m-1",
    created_at: "2026-06-16T10:00:00Z",
    ...overrides,
  };
}

export function myRecordItem(
  overrides: Partial<MyRecordItem> = {},
): MyRecordItem {
  const act = activity();
  return {
    record: record(),
    activity: {
      id: act.id,
      title: act.title,
      starts_at: act.starts_at,
      ends_at: act.ends_at,
      status: act.status,
    },
    org: { id: ORG.id, code: ORG.code, name: ORG.name },
    ...overrides,
  };
}

export function myRecords(overrides: Partial<MyRecords> = {}): MyRecords {
  return {
    totals: { hours: 4, points: 2.5 },
    by_org: [
      {
        org: { id: ORG.id, code: ORG.code, name: ORG.name },
        hours: 4,
        points: 2.5,
      },
    ],
    records: [myRecordItem()],
    ...overrides,
  };
}

export function memberRow(overrides: Partial<MemberRow> = {}): MemberRow {
  return {
    member_id: "m-1",
    user_id: "u-1",
    email: "lan@example.com",
    full_name: "Nguyễn Lan",
    role: "member",
    status: "active",
    student_code: "SV2024",
    class_name: "CNTT01",
    faculty: "Công nghệ thông tin",
    joined_at: "2026-02-01T00:00:00Z",
    total_hours: 12,
    total_points: 5,
    ...overrides,
  };
}

export function memberRecords(
  overrides: {
    records?: VolunteerRecord[];
  } & Partial<MemberRecordsMember> = {},
): MemberRecords {
  const { records = [record()], ...member } = overrides;
  return {
    member: {
      member_id: "m-1",
      full_name: "Nguyễn Lan",
      student_code: "SV2024",
      class_name: "CNTT01",
      faculty: "Công nghệ thông tin",
      email: "lan@example.com",
      ...member,
    },
    records,
  };
}

export function reportsOverview(
  overrides: Partial<ReportsOverview> = {},
): ReportsOverview {
  return {
    totals: {
      activities: 6,
      published: 2,
      completed: 3,
      cancelled: 1,
      registrations: 40,
      approved: 30,
      checked_in: 24,
      checkin_rate: 0.8,
      total_hours: 120,
      total_points: 48,
    },
    monthly: [
      { month: "2026-05", activities: 2, registrations: 12, hours: 30 },
      { month: "2026-06", activities: 4, registrations: 28, hours: 90 },
    ],
    by_faculty: [
      { faculty: "Công nghệ thông tin", members: 10, hours: 80, points: 30 },
      { faculty: null, members: 2, hours: 4, points: 1 },
    ],
    top_volunteers: [
      {
        member_id: "m-1",
        full_name: "Nguyễn Lan",
        student_code: "SV2024",
        faculty: "Công nghệ thông tin",
        hours: 20,
        points: 9,
        record_count: 5,
      },
    ],
    ...overrides,
  };
}

export function activityReportRow(
  overrides: Partial<ActivityReportRow> = {},
): ActivityReportRow {
  return {
    id: "a-1",
    title: "Hiến máu tình nguyện",
    starts_at: "2026-06-15T08:00:00.000Z",
    ends_at: "2026-06-15T17:00:00.000Z",
    status: "completed",
    capacity: 50,
    registered: 45,
    approved: 40,
    checked_in: 32,
    hours_awarded: 160,
    points_awarded: 80,
    ...overrides,
  };
}
