-- AmigoAct — Oracle database schema
-- =============================================================================
-- Domain: organizations (Đoàn trường, CLB, ...) run volunteer activities;
-- members register for them; managers confirm attendance and record
-- volunteer achievements (hours, points, evidence).
--
-- Conventions:
--   * Oracle 23ai+ (gvenzl/oracle-free): native BOOLEAN / JSON / DROP IF EXISTS.
--   * Primary keys are RAW(16) holding UUIDv7 bytes minted application-side
--     (backend.domain.ids.new_id) — no database defaults on id columns.
--   * updated_at is maintained by the BEFORE UPDATE triggers at the end of
--     this file — writers never set it by hand.
--   * Statement splitting for scripts/reset_db.py: plain DDL ends with ';'
--     at end-of-line; PL/SQL blocks (triggers) end with '/' alone on a line;
--     '--' comments anywhere are ignored by Oracle itself.
-- =============================================================================

-- Re-runnable: dropping with CASCADE CONSTRAINTS makes order irrelevant.
DROP TABLE IF EXISTS notifications           CASCADE CONSTRAINTS;
DROP TABLE IF EXISTS volunteer_record_images CASCADE CONSTRAINTS;
DROP TABLE IF EXISTS activity_photos         CASCADE CONSTRAINTS;
DROP TABLE IF EXISTS volunteer_records       CASCADE CONSTRAINTS;
DROP TABLE IF EXISTS activity_registrations  CASCADE CONSTRAINTS;
DROP TABLE IF EXISTS activities              CASCADE CONSTRAINTS;
DROP TABLE IF EXISTS images                  CASCADE CONSTRAINTS;
DROP TABLE IF EXISTS org_members             CASCADE CONSTRAINTS;
DROP TABLE IF EXISTS organizations           CASCADE CONSTRAINTS;
DROP TABLE IF EXISTS users                   CASCADE CONSTRAINTS;
DROP TRIGGER IF EXISTS trg_users_touch;
DROP TRIGGER IF EXISTS trg_organizations_touch;
DROP TRIGGER IF EXISTS trg_org_members_touch;
DROP TRIGGER IF EXISTS trg_activities_touch;
DROP TRIGGER IF EXISTS trg_registrations_touch;
DROP TRIGGER IF EXISTS trg_volrec_touch;
DROP TRIGGER IF EXISTS trg_activity_photos_touch;

-- =============================================================================
-- organizations — a Đoàn trường, student club, or any org running activities.
-- code is the short unique handle shown to members (uppercased by the app).
-- logo_image_id is wired by ALTER once the images table exists.
-- =============================================================================
CREATE TABLE organizations (
    id             RAW(16)                    NOT NULL,
    code           VARCHAR2(32 CHAR)          NOT NULL,
    name           VARCHAR2(200 CHAR)         NOT NULL,
    description    VARCHAR2(2000 CHAR),
    contact_email  VARCHAR2(320 CHAR),
    logo_image_id  RAW(16),
    is_active      BOOLEAN   DEFAULT TRUE     NOT NULL,
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    updated_at     TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    CONSTRAINT pk_organizations PRIMARY KEY (id),
    CONSTRAINT uq_organizations_code UNIQUE (code),
    CONSTRAINT ck_organizations_code CHECK (code = UPPER(code))
);

-- =============================================================================
-- users — global login accounts (org admins, managers, volunteers).
-- Roster membership lives in org_members; a user may belong to many orgs.
-- avatar_image_id is wired by ALTER once the images table exists.
-- =============================================================================
CREATE TABLE users (
    id              RAW(16)                    NOT NULL,
    email           VARCHAR2(320 CHAR)         NOT NULL,
    password_hash   VARCHAR2(255 CHAR)         NOT NULL,  -- argon2id encoded
    full_name       VARCHAR2(120 CHAR)         NOT NULL,
    phone           VARCHAR2(24 CHAR),
    avatar_image_id RAW(16),
    is_active       BOOLEAN   DEFAULT TRUE     NOT NULL,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    CONSTRAINT pk_users        PRIMARY KEY (id),
    CONSTRAINT uq_users_email  UNIQUE (email),
    CONSTRAINT ck_users_email  CHECK (email = LOWER(email))
);

COMMENT ON COLUMN users.password_hash IS 'argon2id hash (RFC 9106 profile); never a plaintext password';
COMMENT ON COLUMN users.is_active     IS 'FALSE disables login without deleting history';

-- =============================================================================
-- org_members — one row per person per org (the roster / danh sách đoàn viên).
-- user_id links the roster entry to a login account and stays NULL until the
-- member registers in the app, so a roster can be imported before accounts
-- exist. Student metadata lives here because it is org-scoped.
-- =============================================================================
CREATE TABLE org_members (
    id           RAW(16)                    NOT NULL,
    org_id       RAW(16)                    NOT NULL,
    user_id      RAW(16),
    role         VARCHAR2(20 CHAR) DEFAULT 'member' NOT NULL,
    status       VARCHAR2(20 CHAR) DEFAULT 'active' NOT NULL,
    full_name    VARCHAR2(120 CHAR)         NOT NULL,  -- roster display name
    student_code VARCHAR2(32 CHAR),                  -- mã sinh viên / đoàn viên
    class_name   VARCHAR2(64 CHAR),                  -- lớp / chi đoàn
    faculty      VARCHAR2(120 CHAR),                 -- khoa / đơn vị
    joined_at    TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    created_at   TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    updated_at   TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    CONSTRAINT pk_org_members       PRIMARY KEY (id),
    CONSTRAINT fk_org_members_org   FOREIGN KEY (org_id)
        REFERENCES organizations (id) ON DELETE CASCADE,
    CONSTRAINT fk_org_members_user  FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT ck_org_members_role   CHECK (role   IN ('member', 'manager', 'admin')),
    CONSTRAINT ck_org_members_status CHECK (status IN ('active', 'inactive'))
);

COMMENT ON COLUMN org_members.role IS 'member = đoàn viên; manager = ban chấp hành; admin = quản trị tổ chức';

-- Unique only when the nullable key is present: rows whose whole key is NULL
-- are not indexed, so unlimited unlinked roster entries can coexist.
CREATE UNIQUE INDEX uq_org_members_user
    ON org_members (CASE WHEN user_id IS NOT NULL THEN org_id END, user_id);
CREATE UNIQUE INDEX uq_org_members_student
    ON org_members (CASE WHEN student_code IS NOT NULL THEN org_id END, student_code);
CREATE INDEX ix_org_members_org  ON org_members (org_id, status);
CREATE INDEX ix_org_members_user ON org_members (user_id);

-- =============================================================================
-- images — binary image storage shared by every feature (avatars, logos,
-- posters, activity galleries, evidence photos). Bytes live in `data`; the
-- other columns are metadata for serving (mime_type, size) and housekeeping
-- (sha256 dedupe, uploaded_by audit).
-- Lifecycle: exactly one owner column is set — org_id for org media (poster,
-- gallery, evidence) or user_id for account media (avatars) — and the image
-- is deleted with its owner. uploaded_by is audit only and may go NULL.
-- Immutable: replace an image with delete + insert, so no updated_at.
-- =============================================================================
CREATE TABLE images (
    id          RAW(16)                    NOT NULL,
    org_id      RAW(16),                            -- owner: organization
    user_id     RAW(16),                            -- owner: user account
    uploaded_by RAW(16),                            -- audit: who uploaded
    file_name   VARCHAR2(255 CHAR)         NOT NULL,
    mime_type   VARCHAR2(100 CHAR)         NOT NULL,
    size_bytes  NUMBER(12)                 NOT NULL,
    sha256      RAW(32),                            -- content hash for dedupe
    width       NUMBER(6),
    height      NUMBER(6),
    data        BLOB                       NOT NULL,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    CONSTRAINT pk_images       PRIMARY KEY (id),
    CONSTRAINT fk_images_org   FOREIGN KEY (org_id)
        REFERENCES organizations (id) ON DELETE CASCADE,
    CONSTRAINT fk_images_user  FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_images_by    FOREIGN KEY (uploaded_by)
        REFERENCES users (id) ON DELETE SET NULL,
    -- exactly one owner: org-scoped media XOR account-scoped media
    CONSTRAINT ck_images_owner CHECK ((org_id IS NULL AND user_id IS NOT NULL)
                                   OR (org_id IS NOT NULL AND user_id IS NULL)),
    CONSTRAINT ck_images_mime  CHECK (mime_type IN ('image/jpeg', 'image/png',
                                                  'image/webp', 'image/gif')),
    CONSTRAINT ck_images_size  CHECK (size_bytes BETWEEN 1 AND 10485760),  -- 10 MiB cap
    CONSTRAINT ck_images_dims  CHECK ((width IS NULL AND height IS NULL)
                                   OR (width > 0 AND height > 0))
);

COMMENT ON COLUMN images.sha256 IS 'SHA-256 of the byte content; lets the app reuse identical uploads';

CREATE INDEX ix_images_org    ON images (org_id);
CREATE INDEX ix_images_user   ON images (user_id);
CREATE INDEX ix_images_sha256 ON images (sha256);
CREATE INDEX ix_images_by     ON images (uploaded_by);

-- Deferred FKs: avatar/logo columns exist on users/organizations but their
-- constraints can only be declared after images does.
ALTER TABLE users
    ADD CONSTRAINT fk_users_avatar FOREIGN KEY (avatar_image_id)
        REFERENCES images (id) ON DELETE SET NULL;
ALTER TABLE organizations
    ADD CONSTRAINT fk_organizations_logo FOREIGN KEY (logo_image_id)
        REFERENCES images (id) ON DELETE SET NULL;

-- =============================================================================
-- activities — a volunteer activity/event (đợt hoạt động tình nguyện).
-- Lifecycle: draft -> published -> completed (or cancelled at any point).
-- points is the default award a completed participation earns (điểm rèn
-- luyện / công tác xã hội); the recorded award may differ per member.
-- hours is the default volunteer-time credit (giờ tình nguyện) a completed
-- participation earns; volunteer_records.hours stores the recorded value.
-- checkin_code is the short code (QR/typing) managers publish for điểm danh.
-- =============================================================================
CREATE TABLE activities (
    id                     RAW(16)                    NOT NULL,
    org_id                 RAW(16)                    NOT NULL,
    title                  VARCHAR2(200 CHAR)         NOT NULL,
    description            CLOB,
    location               VARCHAR2(300 CHAR),
    status                 VARCHAR2(20 CHAR) DEFAULT 'draft' NOT NULL,
    capacity               NUMBER(8),                        -- NULL = unlimited
    points                 NUMBER(6,2) DEFAULT 0      NOT NULL,
    hours                  NUMBER(6,2) DEFAULT 0      NOT NULL,
    poster_image_id        RAW(16),
    registration_opens_at  TIMESTAMP WITH TIME ZONE,
    registration_closes_at TIMESTAMP WITH TIME ZONE,
    starts_at              TIMESTAMP WITH TIME ZONE   NOT NULL,
    ends_at                TIMESTAMP WITH TIME ZONE   NOT NULL,
    checkin_code           VARCHAR2(12 CHAR),
    created_by             RAW(16),
    created_at             TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    updated_at             TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    CONSTRAINT pk_activities       PRIMARY KEY (id),
    CONSTRAINT fk_activities_org   FOREIGN KEY (org_id)
        REFERENCES organizations (id) ON DELETE CASCADE,
    CONSTRAINT fk_activities_poster FOREIGN KEY (poster_image_id)
        REFERENCES images (id) ON DELETE SET NULL,
    CONSTRAINT fk_activities_by    FOREIGN KEY (created_by)
        REFERENCES org_members (id) ON DELETE SET NULL,
    CONSTRAINT ck_activities_status CHECK (status IN ('draft', 'published',
                                                    'cancelled', 'completed')),
    CONSTRAINT ck_activities_capacity CHECK (capacity IS NULL OR capacity > 0),
    CONSTRAINT ck_activities_points   CHECK (points >= 0),
    CONSTRAINT ck_activities_hours    CHECK (hours >= 0),
    CONSTRAINT ck_activities_window   CHECK (ends_at > starts_at),
    CONSTRAINT ck_activities_reg_win  CHECK (registration_opens_at  IS NULL
                                          OR registration_closes_at IS NULL
                                          OR registration_closes_at >= registration_opens_at)
);

-- Check-in codes must be unambiguous within an org when present.
CREATE UNIQUE INDEX uq_activities_checkin
    ON activities (CASE WHEN checkin_code IS NOT NULL THEN org_id END, checkin_code);
-- Per-org listing ("upcoming published events") and cross-org discovery feed.
CREATE INDEX ix_activities_org_list ON activities (org_id, status, starts_at);
CREATE INDEX ix_activities_feed     ON activities (status, starts_at);
-- Sparse: only rows with a check-in code are indexed.
CREATE INDEX ix_activities_checkin  ON activities (checkin_code);

-- =============================================================================
-- activity_registrations — a member signing up for an activity (đăng ký).
-- status covers the review lifecycle; checked_in_at records điểm danh.
-- reviewed_by/reviewed_at name the manager who approved or rejected.
-- =============================================================================
CREATE TABLE activity_registrations (
    id            RAW(16)                    NOT NULL,
    activity_id   RAW(16)                    NOT NULL,
    member_id     RAW(16)                    NOT NULL,
    status        VARCHAR2(20 CHAR) DEFAULT 'pending' NOT NULL,
    note          VARCHAR2(500 CHAR),                 -- message from the member
    checked_in_at TIMESTAMP WITH TIME ZONE,           -- attendance proof
    reviewed_by   RAW(16),
    reviewed_at   TIMESTAMP WITH TIME ZONE,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    updated_at    TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    CONSTRAINT pk_registrations         PRIMARY KEY (id),
    CONSTRAINT fk_registrations_act     FOREIGN KEY (activity_id)
        REFERENCES activities (id) ON DELETE CASCADE,
    CONSTRAINT fk_registrations_member  FOREIGN KEY (member_id)
        REFERENCES org_members (id) ON DELETE CASCADE,
    CONSTRAINT fk_registrations_reviewer FOREIGN KEY (reviewed_by)
        REFERENCES org_members (id) ON DELETE SET NULL,
    CONSTRAINT uq_registrations UNIQUE (activity_id, member_id),
    CONSTRAINT ck_registrations_status  CHECK (status IN ('pending', 'approved',
                                                        'rejected', 'cancelled'))
);

-- Leading column of uq_registrations already indexes activity lookups;
-- this one serves "my registrations" / per-member status filters.
CREATE INDEX ix_registrations_member ON activity_registrations (member_id, status);

-- =============================================================================
-- volunteer_records — the official ghi nhận thành tích: what a member earned.
-- Usually derives from an attended registration (registration_id), but may be
-- recorded standalone for external/certified service — then activity_id is
-- NULL. title is a denormalized snapshot so a record stays meaningful after
-- its activity is deleted. Photo evidence lives in volunteer_record_images.
-- =============================================================================
CREATE TABLE volunteer_records (
    id              RAW(16)                    NOT NULL,
    member_id       RAW(16)                    NOT NULL,
    activity_id     RAW(16),
    registration_id RAW(16),
    title           VARCHAR2(200 CHAR)         NOT NULL,
    hours           NUMBER(6,2),                        -- giờ tình nguyện
    points          NUMBER(6,2) DEFAULT 0      NOT NULL,
    awarded_on      DATE DEFAULT TRUNC(SYSDATE) NOT NULL,
    note            VARCHAR2(1000 CHAR),
    evidence_url    VARCHAR2(500 CHAR),                 -- link minh chứng ngoài
    recorded_by     RAW(16),
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    CONSTRAINT pk_volrec       PRIMARY KEY (id),
    CONSTRAINT fk_volrec_member FOREIGN KEY (member_id)
        REFERENCES org_members (id) ON DELETE CASCADE,
    CONSTRAINT fk_volrec_act    FOREIGN KEY (activity_id)
        REFERENCES activities (id) ON DELETE SET NULL,
    CONSTRAINT fk_volrec_reg    FOREIGN KEY (registration_id)
        REFERENCES activity_registrations (id) ON DELETE SET NULL,
    CONSTRAINT fk_volrec_by     FOREIGN KEY (recorded_by)
        REFERENCES org_members (id) ON DELETE SET NULL,
    CONSTRAINT uq_volrec_reg UNIQUE (registration_id),   -- at most one per sign-up
    CONSTRAINT ck_volrec_hours  CHECK (hours IS NULL OR hours >= 0),
    CONSTRAINT ck_volrec_points CHECK (points >= 0)
);

COMMENT ON COLUMN volunteer_records.hours IS 'Volunteer hours (giờ tình nguyện) credited for this record';

-- One record per member per activity; standalone rows (activity_id NULL) are
-- never indexed, so a member can hold any number of manual records.
CREATE UNIQUE INDEX uq_volrec_member_activity
    ON volunteer_records (CASE WHEN activity_id IS NOT NULL THEN member_id END, activity_id);
-- Achievement history ordered by award date.
CREATE INDEX ix_volrec_member   ON volunteer_records (member_id, awarded_on);
CREATE INDEX ix_volrec_activity ON volunteer_records (activity_id);

-- =============================================================================
-- activity_photos — gallery images attached to an activity, ordered by
-- sort_order for display. The image row holds bytes + metadata; this table
-- is only the attachment.
-- =============================================================================
CREATE TABLE activity_photos (
    id          RAW(16)                    NOT NULL,
    activity_id RAW(16)                    NOT NULL,
    image_id    RAW(16)                    NOT NULL,
    caption     VARCHAR2(300 CHAR),
    sort_order  NUMBER(4)   DEFAULT 0      NOT NULL,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    CONSTRAINT pk_activity_photos     PRIMARY KEY (id),
    CONSTRAINT fk_activity_photos_act FOREIGN KEY (activity_id)
        REFERENCES activities (id) ON DELETE CASCADE,
    CONSTRAINT fk_activity_photos_img FOREIGN KEY (image_id)
        REFERENCES images (id) ON DELETE CASCADE,
    CONSTRAINT uq_activity_photos UNIQUE (activity_id, image_id)
);

-- Reverse lookup: "which activities reference this image" (for safe deletes).
CREATE INDEX ix_activity_photos_img ON activity_photos (image_id);

-- =============================================================================
-- volunteer_record_images — uploaded photo evidence (ảnh minh chứng) for an
-- achievement record. Pure join: images cascade away with the record.
-- =============================================================================
CREATE TABLE volunteer_record_images (
    id         RAW(16)                    NOT NULL,
    record_id  RAW(16)                    NOT NULL,
    image_id   RAW(16)                    NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    CONSTRAINT pk_volrec_images     PRIMARY KEY (id),
    CONSTRAINT fk_volrec_images_rec FOREIGN KEY (record_id)
        REFERENCES volunteer_records (id) ON DELETE CASCADE,
    CONSTRAINT fk_volrec_images_img FOREIGN KEY (image_id)
        REFERENCES images (id) ON DELETE CASCADE,
    CONSTRAINT uq_volrec_images UNIQUE (record_id, image_id)
);

CREATE INDEX ix_volrec_images_img ON volunteer_record_images (image_id);

-- =============================================================================
-- notifications — persisted messages pushed to a signed-in user over the
-- WebSocket channel (/api/ws); read_at doubles as the read marker.
-- =============================================================================
CREATE TABLE notifications (
    id         RAW(16)                    NOT NULL,
    user_id    RAW(16)                    NOT NULL,
    type       VARCHAR2(50 CHAR)          NOT NULL,   -- e.g. 'registration.approved'
    title      VARCHAR2(200 CHAR)         NOT NULL,
    body       VARCHAR2(1000 CHAR),
    data       JSON,                                  -- optional payload for the client
    read_at    TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    CONSTRAINT pk_notifications      PRIMARY KEY (id),
    CONSTRAINT fk_notifications_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_notifications_user ON notifications (user_id, created_at);

-- =============================================================================
-- updated_at maintenance — a BEFORE UPDATE trigger stamps every row change,
-- so writers can never forget it. One identical trigger per mutable table.
-- Each block ends with '/' alone on a line (SQL*Plus convention).
-- =============================================================================
CREATE OR REPLACE TRIGGER trg_users_touch
BEFORE UPDATE ON users
FOR EACH ROW
BEGIN
    :NEW.updated_at := SYSTIMESTAMP;
END;
/

CREATE OR REPLACE TRIGGER trg_organizations_touch
BEFORE UPDATE ON organizations
FOR EACH ROW
BEGIN
    :NEW.updated_at := SYSTIMESTAMP;
END;
/

CREATE OR REPLACE TRIGGER trg_org_members_touch
BEFORE UPDATE ON org_members
FOR EACH ROW
BEGIN
    :NEW.updated_at := SYSTIMESTAMP;
END;
/

CREATE OR REPLACE TRIGGER trg_activities_touch
BEFORE UPDATE ON activities
FOR EACH ROW
BEGIN
    :NEW.updated_at := SYSTIMESTAMP;
END;
/

CREATE OR REPLACE TRIGGER trg_registrations_touch
BEFORE UPDATE ON activity_registrations
FOR EACH ROW
BEGIN
    :NEW.updated_at := SYSTIMESTAMP;
END;
/

CREATE OR REPLACE TRIGGER trg_volrec_touch
BEFORE UPDATE ON volunteer_records
FOR EACH ROW
BEGIN
    :NEW.updated_at := SYSTIMESTAMP;
END;
/

CREATE OR REPLACE TRIGGER trg_activity_photos_touch
BEFORE UPDATE ON activity_photos
FOR EACH ROW
BEGIN
    :NEW.updated_at := SYSTIMESTAMP;
END;
/
