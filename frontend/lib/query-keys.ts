/**
 * Frozen TanStack Query key registry.
 *
 * Every cached query in the app takes its key from `qk`, and the realtime
 * layer (`lib/realtime-events.ts`) invalidates by these prefixes — TanStack
 * Query treats a key as a prefix match, so `["activity-regs", id]` catches
 * every status-filtered variant `["activity-regs", id, status]`.
 *
 * Keep shapes consistent: id-scoped keys are `[name, id]`, optionally
 * followed by a filter value. Feature phases must not invent parallel keys.
 *
 * Framework-free: no `next/*` or React imports.
 */

/** Optional report filter parameters (period, member, activity…). */
export type ReportParams = Record<string, string | number | boolean>;

export const qk = {
  /** `GET /api/auth/me` — the signed-in account plus memberships. */
  me: ["me"],
  /** One organisation. */
  orgs: (orgId: string) => ["orgs", orgId],
  /** Activities of an org; `status` scopes to a filter variant. */
  orgActivities: (orgId: string, status?: string) =>
    status === undefined
      ? ["org-activities", orgId]
      : ["org-activities", orgId, status],
  /** One activity. */
  activity: (activityId: string) => ["activity", activityId],
  /** Registrations of an activity; `status` scopes to a filter variant. */
  activityRegs: (activityId: string, status?: string) =>
    status === undefined
      ? ["activity-regs", activityId]
      : ["activity-regs", activityId, status],
  /** Check-ins of an activity. */
  activityCheckins: (activityId: string) => ["activity-checkins", activityId],
  /** The signed-in user's registrations across orgs. */
  meRegistrations: ["me-registrations"],
  /** The signed-in user's volunteer records. */
  meRecords: ["me-records"],
  /** The member roster of an org (manager view). */
  orgMembers: (orgId: string) => ["org-members", orgId],
  /** Records of one member inside an org; omit `memberId` for the org prefix. */
  memberRecords: (orgId: string, memberId?: string) =>
    memberId === undefined
      ? ["member-records", orgId]
      : ["member-records", orgId, memberId],
  /**
   * Org reports; `scope` selects the endpoint (`"overview"`,
   * `"activities"`), `params` the date-range filters. The `["reports", id]`
   * prefix covers every variant for realtime invalidation.
   */
  reports: (orgId: string, scope?: string, params?: ReportParams) => {
    const key: unknown[] = ["reports", orgId];
    if (scope !== undefined) {
      key.push(scope);
    }
    if (params !== undefined) {
      key.push(params);
    }
    return key;
  },
  /** The signed-in user's activity feed. */
  feed: ["feed"],
} as const;

/** A TanStack Query key produced by `qk`. */
export type QueryKey = readonly unknown[];
