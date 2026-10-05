-- AMONG BUG — four-slot event schema (2 days × 2 slots × 4 sprints).
-- PostgreSQL is the single source of truth. Sockets are delivery only.
-- Every competition row is scoped to an event and (where relevant) a slot.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Event, days, slots, sprints
-- ---------------------------------------------------------------------------
CREATE TABLE event (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,                     -- display name, default "AMONG BUG"
  organizer             text NOT NULL DEFAULT 'IDEALab.h',
  edition               text NOT NULL DEFAULT 'AAROHAN 2026',
  venue                 text NOT NULL DEFAULT 'SGSITS Indore',
  timezone              text NOT NULL DEFAULT 'Asia/Kolkata',
  is_demo               boolean NOT NULL DEFAULT false,
  rules                 jsonb NOT NULL,                    -- validated by server/src/services/rules.ts
  rule_confirmations    jsonb NOT NULL DEFAULT '{}'::jsonb,-- { ruleKey: { by, byName, at } }
  rules_frozen_at       timestamptz,
  phase                 text NOT NULL DEFAULT 'OPEN' CHECK (phase IN ('OPEN', 'FINAL_REVIEW', 'FINALIZED')),
  finalized_at          timestamptz,
  version               int NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE event_day (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES event(id),
  day_number  int NOT NULL CHECK (day_number >= 1),
  label       text NOT NULL,
  date        date NOT NULL,
  UNIQUE (event_id, day_number)
);

CREATE TABLE slot (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            uuid NOT NULL REFERENCES event(id),
  day_id              uuid NOT NULL REFERENCES event_day(id),
  number              int NOT NULL CHECK (number BETWEEN 1 AND 8),
  name                text NOT NULL,
  -- Real clock times are organizer-supplied; a date label never auto-starts anything.
  scheduled_start_at  timestamptz,
  capacity            int NOT NULL DEFAULT 10 CHECK (capacity BETWEEN 1 AND 500),
  phase               text NOT NULL DEFAULT 'CONFIGURING' CHECK (phase IN ('CONFIGURING', 'READY', 'WAITING', 'RUNNING', 'REVIEW', 'COMPLETED')),
  current_sprint      int NOT NULL DEFAULT 0 CHECK (current_sprint BETWEEN 0 AND 4),
  finalized_at        timestamptz,
  version             int NOT NULL DEFAULT 1,
  UNIQUE (event_id, number)
);

CREATE TABLE sprint (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id             uuid NOT NULL REFERENCES slot(id),
  number              int NOT NULL CHECK (number BETWEEN 1 AND 4),
  status              text NOT NULL DEFAULT 'READY' CHECK (status IN ('READY', 'RUNNING', 'PAUSED', 'CLOSED', 'FINALIZED')),
  duration_seconds    int NOT NULL CHECK (duration_seconds >= 30),
  eliminate_count     int NOT NULL DEFAULT 0 CHECK (eliminate_count >= 0),
  started_at          timestamptz,
  deadline_at         timestamptz,
  paused_at           timestamptz,
  paused_total_ms     bigint NOT NULL DEFAULT 0,
  closed_at           timestamptz,
  close_reason        text,
  frozen_snapshot_id  uuid,
  version             int NOT NULL DEFAULT 1,
  UNIQUE (slot_id, number)
);

-- ---------------------------------------------------------------------------
-- Teams (imported), roster, slot enrollment (exactly one slot per team)
-- ---------------------------------------------------------------------------
CREATE SEQUENCE crew_number_seq START 1;

CREATE TABLE team (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id              uuid NOT NULL REFERENCES event(id),
  crew_id               text NOT NULL UNIQUE,
  name                  text NOT NULL,
  name_normalized       text NOT NULL,
  email                 text NOT NULL,
  email_normalized      text NOT NULL,
  captain_name          text NOT NULL,
  -- NULL until credentials are provisioned; such crews cannot sign in.
  password_hash         text,
  credential_status     text NOT NULL DEFAULT 'NONE' CHECK (credential_status IN ('NONE', 'ISSUED', 'DELIVERED')),
  must_change_password  boolean NOT NULL DEFAULT false,
  color                 text NOT NULL,
  account_enabled       boolean NOT NULL DEFAULT true,
  checked_in_at         timestamptz,
  status                text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_via           text NOT NULL CHECK (created_via IN ('IMPORT', 'ADMIN', 'SEED')),
  version               int NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, email_normalized),
  UNIQUE (event_id, name_normalized)
);

CREATE TABLE team_member (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id      uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  position     int NOT NULL CHECK (position BETWEEN 1 AND 4),
  name         text NOT NULL,
  institution  text NOT NULL DEFAULT '',
  year         text NOT NULL DEFAULT '',
  branch       text NOT NULL DEFAULT '',
  student_id   text,
  is_captain   boolean NOT NULL DEFAULT false,
  UNIQUE (team_id, position)
);

CREATE TABLE slot_enrollment (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id                  uuid NOT NULL REFERENCES slot(id),
  team_id                  uuid NOT NULL UNIQUE REFERENCES team(id),   -- at most one slot per team
  status                   text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ELIMINATED', 'DISQUALIFIED')),
  eliminated_sprint        int,
  wallet_balance           int NOT NULL DEFAULT 0 CHECK (wallet_balance >= 0),
  earned_total             int NOT NULL DEFAULT 0,
  spent_total              int NOT NULL DEFAULT 0,
  grant_total              int NOT NULL DEFAULT 0,
  score_adjust             int NOT NULL DEFAULT 0,
  tasks_solved             int NOT NULL DEFAULT 0,
  version                  int NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX slot_enrollment_slot ON slot_enrollment(slot_id);

-- ---------------------------------------------------------------------------
-- Organizers, sessions (TEAM / ORGANIZER / DISPLAY), display links, idempotency
-- ---------------------------------------------------------------------------
CREATE TABLE organizer_user (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            text NOT NULL,
  email_normalized text NOT NULL UNIQUE,
  display_name     text NOT NULL,
  role             text NOT NULL CHECK (role IN ('SUPER_ADMIN', 'OPERATOR', 'CONTENT_EDITOR')),
  password_hash    text NOT NULL,
  active           boolean NOT NULL DEFAULT true,
  created_via      text NOT NULL DEFAULT 'BOOTSTRAP',
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_login_at    timestamptz
);

-- Revocable read-only projector links. The token is shown once; only its hash is stored.
CREATE TABLE display_link (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES event(id),
  label       text NOT NULL,
  token_hash  text NOT NULL UNIQUE,
  created_by  uuid NOT NULL REFERENCES organizer_user(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz
);

CREATE TABLE session (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash       text NOT NULL UNIQUE,
  actor_type       text NOT NULL CHECK (actor_type IN ('TEAM', 'ORGANIZER', 'DISPLAY')),
  team_id          uuid REFERENCES team(id),
  organizer_id     uuid REFERENCES organizer_user(id),
  display_link_id  uuid REFERENCES display_link(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  revoked_at       timestamptz,
  revoke_reason    text,
  user_agent       text,
  ip               text,
  CHECK ((actor_type = 'TEAM' AND team_id IS NOT NULL) OR
         (actor_type = 'ORGANIZER' AND organizer_id IS NOT NULL) OR
         (actor_type = 'DISPLAY' AND display_link_id IS NOT NULL))
);
CREATE INDEX session_team_live ON session(team_id) WHERE revoked_at IS NULL;

CREATE TABLE idempotency_record (
  actor_key    text NOT NULL,
  scope        text NOT NULL,
  key          text NOT NULL,
  fingerprint  text NOT NULL,
  response     jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_key, scope, key)
);

-- ---------------------------------------------------------------------------
-- Imports and credential delivery
-- ---------------------------------------------------------------------------
CREATE TABLE import_batch (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid NOT NULL REFERENCES event(id),
  kind          text NOT NULL CHECK (kind IN ('TEAMS', 'QUESTIONS')),
  status        text NOT NULL DEFAULT 'PREVIEWED' CHECK (status IN ('PREVIEWED', 'COMMITTED', 'DISCARDED')),
  file_name     text NOT NULL,
  mapping       jsonb NOT NULL DEFAULT '{}'::jsonb,
  rows          jsonb NOT NULL,      -- normalized rows with planned action per row
  errors        jsonb NOT NULL,      -- [{ row, field, message }]
  summary       jsonb NOT NULL,
  created_by    uuid NOT NULL REFERENCES organizer_user(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  committed_at  timestamptz,
  result        jsonb
);

CREATE TABLE credential_delivery (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       uuid NOT NULL REFERENCES team(id),
  channel       text NOT NULL CHECK (channel IN ('CAPTURE', 'SMTP')),
  recipient     text NOT NULL,
  subject       text NOT NULL,
  status        text NOT NULL CHECK (status IN ('CAPTURED', 'SENT', 'FAILED')),
  error         text,
  reason        text NOT NULL,       -- INITIAL / RESET
  created_by    uuid NOT NULL REFERENCES organizer_user(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Demo / local mail capture: "demo mail, not delivered externally". SUPER_ADMIN only.
CREATE TABLE mail_capture (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id  uuid NOT NULL REFERENCES credential_delivery(id),
  recipient    text NOT NULL,
  subject      text NOT NULL,
  body         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Question bank (private) and slot-scoped instances / releases
-- ---------------------------------------------------------------------------
CREATE TABLE domain (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text NOT NULL UNIQUE,
  name       text NOT NULL,
  room       text NOT NULL,
  color      text NOT NULL,
  symbol     text NOT NULL,
  prefix     text NOT NULL,
  workspace  text NOT NULL,
  sort       int NOT NULL DEFAULT 0
);

CREATE TABLE question (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,
  domain_id   uuid NOT NULL REFERENCES domain(id),
  title       text NOT NULL,
  -- REGULAR questions feed initial/reserve releases; BONUS questions feed bonus releases.
  pool        text NOT NULL DEFAULT 'REGULAR' CHECK (pool IN ('REGULAR', 'BONUS')),
  archived    boolean NOT NULL DEFAULT false,
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE question_version (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id      uuid NOT NULL REFERENCES question(id),
  version_no       int NOT NULL,
  status           text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'REVIEWED', 'PUBLISHED', 'ARCHIVED')),
  title            text NOT NULL,
  difficulty       text NOT NULL CHECK (difficulty IN ('EASY', 'MEDIUM', 'HARD')),
  statement        text NOT NULL,
  workspace        text NOT NULL,
  run_language     text CHECK (run_language IN ('javascript', 'python')),
  run_entry        text,
  files            jsonb NOT NULL,
  sample_stdin     text,
  answer_format    text NOT NULL,
  validation       jsonb NOT NULL,   -- server-only; EXACT_TEXT answers removed in favour of answer_verifier
  answer_verifier  text,
  hint             text NOT NULL,
  solution         jsonb NOT NULL,   -- private walkthrough + files; organizers with solution access only
  source_template  text,
  source_seed      int,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  reviewed_at      timestamptz,
  reviewed_by      uuid,
  published_at     timestamptz,
  UNIQUE (question_id, version_no)
);

-- A release makes a group of instances available in one slot.
CREATE TABLE release (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id               uuid NOT NULL REFERENCES slot(id),
  sprint_id             uuid REFERENCES sprint(id),          -- NULL = slot pool (carries across sprints)
  type                  text NOT NULL CHECK (type IN ('INITIAL', 'RESERVE', 'BONUS')),
  label                 text NOT NULL,
  status                text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SCHEDULED', 'RELEASED', 'CANCELLED')),
  offset_seconds        int CHECK (offset_seconds >= 0),     -- active-time offset within its sprint (SCHEDULED)
  expires_at_sprint_end boolean NOT NULL DEFAULT true,
  blueprint_key         text,                                -- identical across comparable slots
  announcement          text,
  manual                boolean NOT NULL DEFAULT false,
  deviation_reason      text,                                -- manual override → fairness deviation
  released_at           timestamptz,
  released_in_sprint_id uuid REFERENCES sprint(id),
  released_by           uuid,
  version               int NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slot_id, blueprint_key)
);
CREATE INDEX release_slot ON release(slot_id, status);

CREATE TABLE question_instance (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id                  uuid NOT NULL REFERENCES slot(id),
  release_id               uuid NOT NULL REFERENCES release(id),
  question_version_id      uuid NOT NULL REFERENCES question_version(id),
  domain_id                uuid NOT NULL REFERENCES domain(id),
  kind                     text NOT NULL CHECK (kind IN ('INITIAL', 'RESERVE', 'BONUS')),
  label                    text NOT NULL,
  difficulty               text NOT NULL,
  reward                   int NOT NULL CHECK (reward >= 0),
  hint_cost                int NOT NULL CHECK (hint_cost >= 0),
  generation               int NOT NULL DEFAULT 1,
  status                   text NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'SOLVED', 'EXPIRED', 'DISABLED')),
  expires_with_sprint_id   uuid REFERENCES sprint(id),       -- fresh-per-sprint instances expire with this sprint
  solved_by_enrollment_id  uuid REFERENCES slot_enrollment(id),
  solved_at                timestamptz,
  solved_sprint_id         uuid REFERENCES sprint(id),
  version                  int NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slot_id, label)
);
CREATE INDEX question_instance_release ON question_instance(release_id);
CREATE INDEX question_instance_slot ON question_instance(slot_id, status);

CREATE TABLE submission (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id              uuid NOT NULL REFERENCES slot(id),
  sprint_id            uuid REFERENCES sprint(id),
  enrollment_id        uuid NOT NULL REFERENCES slot_enrollment(id),
  session_id           uuid,
  instance_id          uuid NOT NULL REFERENCES question_instance(id),
  generation           int NOT NULL,
  kind                 text NOT NULL CHECK (kind IN ('ANSWER', 'CODE')),
  payload_hash         text NOT NULL,
  code                 jsonb,
  correct              boolean NOT NULL,
  result_code          text NOT NULL,
  judge                jsonb,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX submission_enrollment ON submission(enrollment_id, created_at);

CREATE TABLE solve_award (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id    uuid NOT NULL REFERENCES question_instance(id),
  generation     int NOT NULL,
  enrollment_id  uuid NOT NULL REFERENCES slot_enrollment(id),
  submission_id  uuid NOT NULL REFERENCES submission(id),
  sprint_id      uuid NOT NULL REFERENCES sprint(id),       -- attributed to the sprint in which it was accepted
  reward         int NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instance_id, generation)
);

-- ---------------------------------------------------------------------------
-- IdeaCoins: immutable ledger + reconciled caches on slot_enrollment
-- ---------------------------------------------------------------------------
CREATE TABLE coin_ledger (
  id              bigserial PRIMARY KEY,
  slot_id         uuid NOT NULL REFERENCES slot(id),
  sprint_id       uuid REFERENCES sprint(id),               -- NULL = slot-level (e.g. grant / slot adjustment)
  enrollment_id   uuid NOT NULL REFERENCES slot_enrollment(id),
  kind            text NOT NULL CHECK (kind IN ('SOLVE_REWARD', 'BONUS_REWARD', 'HINT_PURCHASE', 'GRANT', 'ADJUSTMENT')),
  wallet_delta    int NOT NULL,
  earned_delta    int NOT NULL DEFAULT 0,
  spent_delta     int NOT NULL DEFAULT 0,
  grant_delta     int NOT NULL DEFAULT 0,
  score_delta     int NOT NULL DEFAULT 0,
  wallet_after    int NOT NULL,
  source_type     text NOT NULL,
  source_id       uuid NOT NULL,
  reason          text,
  actor_id        uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id)
);
CREATE INDEX coin_ledger_slot ON coin_ledger(slot_id, sprint_id);
CREATE INDEX coin_ledger_enrollment ON coin_ledger(enrollment_id, id);

CREATE TABLE hint_purchase (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id              uuid NOT NULL REFERENCES slot(id),
  sprint_id            uuid REFERENCES sprint(id),
  enrollment_id        uuid NOT NULL REFERENCES slot_enrollment(id),
  instance_id          uuid NOT NULL REFERENCES question_instance(id),
  question_version_id  uuid NOT NULL REFERENCES question_version(id),
  cost                 int NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, instance_id, question_version_id)
);

-- ---------------------------------------------------------------------------
-- Snapshots, optional elimination, disqualification, results, announcements
-- ---------------------------------------------------------------------------
CREATE TABLE ranking_snapshot (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES event(id),
  slot_id     uuid REFERENCES slot(id),
  sprint_id   uuid REFERENCES sprint(id),
  scope       text NOT NULL CHECK (scope IN ('SPRINT', 'SLOT', 'EVENT')),
  metric      text NOT NULL,
  rows        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE elimination_batch (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id                   uuid NOT NULL REFERENCES slot(id),
  sprint_id                 uuid NOT NULL UNIQUE REFERENCES sprint(id),
  snapshot_id               uuid NOT NULL REFERENCES ranking_snapshot(id),
  configured_count          int NOT NULL,
  eliminated_enrollment_ids uuid[] NOT NULL,
  resolution                jsonb NOT NULL,
  note                      text,
  confirmed_by              uuid NOT NULL,
  confirmed_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE disqualification (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       uuid NOT NULL REFERENCES team(id),
  reason        text NOT NULL,
  actor_id      uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  revoked_by    uuid,
  revoke_reason text
);

CREATE TABLE prize_rule (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id  uuid NOT NULL REFERENCES event(id),
  place     int NOT NULL CHECK (place >= 1),
  label     text NOT NULL,
  UNIQUE (event_id, place)
);

CREATE TABLE slot_result (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id       uuid NOT NULL UNIQUE REFERENCES slot(id),
  snapshot_id   uuid NOT NULL REFERENCES ranking_snapshot(id),
  rows          jsonb NOT NULL,
  resolution    jsonb NOT NULL,
  note          text,
  confirmed_by  uuid NOT NULL,
  confirmed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE event_result (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid NOT NULL UNIQUE REFERENCES event(id),
  snapshot_id   uuid NOT NULL REFERENCES ranking_snapshot(id),
  rows          jsonb NOT NULL,
  resolution    jsonb NOT NULL,
  note          text,
  confirmed_by  uuid NOT NULL,
  confirmed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE announcement (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES event(id),
  slot_id     uuid REFERENCES slot(id),
  message     text NOT NULL,
  kind        text NOT NULL DEFAULT 'INFO',
  actor_id    uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE run_job (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id        uuid NOT NULL REFERENCES slot(id),
  enrollment_id  uuid NOT NULL REFERENCES slot_enrollment(id),
  session_id     uuid,
  instance_id    uuid NOT NULL REFERENCES question_instance(id),
  language       text NOT NULL,
  status         text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED')),
  result         jsonb,
  error          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz
);
CREATE INDEX run_job_enrollment ON run_job(enrollment_id, created_at);

CREATE TABLE audit_log (
  id           bigserial PRIMARY KEY,
  actor_type   text NOT NULL,
  actor_id     uuid,
  action       text NOT NULL,
  target_type  text,
  target_id    text,
  reason       text,
  details      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created ON audit_log(created_at DESC);

CREATE TABLE outbox_event (
  id          bigserial PRIMARY KEY,
  topic       text NOT NULL,
  rooms       text[] NOT NULL,
  payload     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE worker_heartbeat (
  name     text PRIMARY KEY,
  beat_at  timestamptz NOT NULL,
  info     jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;
CREATE TRIGGER coin_ledger_append_only BEFORE UPDATE OR DELETE ON coin_ledger FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE FUNCTION outbox_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('outbox', NEW.id::text);
  RETURN NEW;
END $$;
CREATE TRIGGER outbox_event_notify AFTER INSERT ON outbox_event FOR EACH ROW EXECUTE FUNCTION outbox_notify();
