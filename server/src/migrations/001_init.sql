-- AMONG BUGS core schema.
-- PostgreSQL is the single source of truth. Sockets are delivery only.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Event, days, games, sprints
-- ---------------------------------------------------------------------------
CREATE TABLE event (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  timezone              text NOT NULL DEFAULT 'Asia/Kolkata',
  -- AUTO: today's date in `timezone` selects the event day. MANUAL: manual_day_id.
  day_selection_mode    text NOT NULL DEFAULT 'MANUAL' CHECK (day_selection_mode IN ('AUTO', 'MANUAL')),
  manual_day_id         uuid,
  is_demo               boolean NOT NULL DEFAULT false,
  session_limit         int NOT NULL DEFAULT 4 CHECK (session_limit BETWEEN 1 AND 20),
  session_limit_policy  text NOT NULL DEFAULT 'EVICT_OLDEST' CHECK (session_limit_policy IN ('EVICT_OLDEST', 'REJECT')),
  version               int NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE event_day (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES event(id),
  day_number  int NOT NULL CHECK (day_number >= 1),
  label       text NOT NULL,
  date        date,
  UNIQUE (event_id, day_number)
);
ALTER TABLE event ADD CONSTRAINT event_manual_day_fk FOREIGN KEY (manual_day_id) REFERENCES event_day(id);

CREATE TABLE game (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id                  uuid NOT NULL REFERENCES event(id),
  number                    int NOT NULL CHECK (number >= 1),
  name                      text NOT NULL,
  day_id                    uuid REFERENCES event_day(id),
  phase                     text NOT NULL DEFAULT 'DRAFT' CHECK (phase IN (
                              'DRAFT', 'READY', 'WAITING', 'RUNNING', 'PAUSED', 'CLOSED',
                              'ELIMINATION_REVIEW', 'WAITING_NEXT_SPRINT', 'GAME_RESULT_REVIEW', 'COMPLETED')),
  current_sprint            int NOT NULL DEFAULT 0 CHECK (current_sprint BETWEEN 0 AND 2),
  ranking_metric            text NOT NULL DEFAULT 'NET_COINS' CHECK (ranking_metric IN ('NET_COINS', 'GROSS_EARNED')),
  ranking_metric_confirmed  boolean NOT NULL DEFAULT false,
  starting_coins            int NOT NULL DEFAULT 0 CHECK (starting_coins >= 0),
  imposter_mode             text NOT NULL DEFAULT 'RESERVE' CHECK (imposter_mode IN ('RESERVE', 'OPEN')),
  imposter_blocks_regular   boolean NOT NULL DEFAULT true,
  recycle_eliminated_solves boolean NOT NULL DEFAULT false,
  duration_preset           text NOT NULL DEFAULT 'STANDARD' CHECK (duration_preset IN ('STANDARD', 'REHEARSAL', 'CUSTOM')),
  prize_places              int NOT NULL DEFAULT 3 CHECK (prize_places BETWEEN 0 AND 10),
  rules_frozen_at           timestamptz,
  version                   int NOT NULL DEFAULT 1,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, number)
);

CREATE TABLE sprint (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id                   uuid NOT NULL REFERENCES game(id),
  number                    int NOT NULL CHECK (number IN (1, 2)),
  status                    text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'PAUSED', 'CLOSED', 'FINALIZED')),
  duration_seconds          int NOT NULL CHECK (duration_seconds >= 30),
  eliminate_count           int CHECK (eliminate_count >= 0),
  started_at                timestamptz,
  deadline_at               timestamptz,
  paused_at                 timestamptz,
  paused_total_ms           bigint NOT NULL DEFAULT 0,
  closed_at                 timestamptz,
  close_reason              text,
  frozen_snapshot_id        uuid,
  version                   int NOT NULL DEFAULT 1,
  UNIQUE (game_id, number)
);

-- ---------------------------------------------------------------------------
-- Teams (one shared identity per crew), roster, eligibility, enrollment
-- ---------------------------------------------------------------------------
CREATE SEQUENCE crew_number_seq START 1;

CREATE TABLE team (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id                    uuid NOT NULL REFERENCES event(id),
  crew_id                     text NOT NULL UNIQUE,
  name                        text NOT NULL,
  name_normalized             text NOT NULL,
  email                       text NOT NULL,
  email_normalized            text NOT NULL,
  captain_name                text NOT NULL,
  password_hash               text NOT NULL,
  color                       text NOT NULL,
  requested_days              text NOT NULL CHECK (requested_days IN ('DAY1', 'DAY2', 'BOTH')),
  rules_accepted_at           timestamptz NOT NULL,
  status                      text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_via                 text NOT NULL CHECK (created_via IN ('SELF', 'ADMIN', 'IMPORT', 'SEED')),
  must_change_password        boolean NOT NULL DEFAULT false,
  registration_idempotency_key text UNIQUE,
  version                     int NOT NULL DEFAULT 1,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, email_normalized),
  UNIQUE (event_id, name_normalized)
);

CREATE TABLE team_member (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id      uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  position     int NOT NULL CHECK (position BETWEEN 1 AND 4),
  name         text NOT NULL,
  institution  text NOT NULL,
  year         text NOT NULL,
  branch       text NOT NULL,
  student_id   text,
  is_captain   boolean NOT NULL DEFAULT false,
  UNIQUE (team_id, position)
);

CREATE TABLE team_day_eligibility (
  team_id       uuid NOT NULL REFERENCES team(id),
  day_id        uuid NOT NULL REFERENCES event_day(id),
  active        boolean NOT NULL DEFAULT false,
  checked_in_at timestamptz,
  updated_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, day_id)
);

CREATE TABLE game_enrollment (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id                  uuid NOT NULL REFERENCES game(id),
  team_id                  uuid NOT NULL REFERENCES team(id),
  status                   text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ELIMINATED', 'DISQUALIFIED')),
  eliminated_sprint        int,
  elimination_batch_id     uuid,
  wallet_balance           int NOT NULL DEFAULT 0 CHECK (wallet_balance >= 0),
  earned_total             int NOT NULL DEFAULT 0,
  spent_total              int NOT NULL DEFAULT 0,
  grant_total              int NOT NULL DEFAULT 0,
  score_adjust             int NOT NULL DEFAULT 0,
  tasks_solved             int NOT NULL DEFAULT 0,
  active_reservation_id    uuid,
  version                  int NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, team_id)
);
CREATE INDEX game_enrollment_game ON game_enrollment(game_id);

-- ---------------------------------------------------------------------------
-- Admins, sessions, resets, idempotency
-- ---------------------------------------------------------------------------
CREATE TABLE admin_user (
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

CREATE TABLE session (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash      text NOT NULL UNIQUE,
  actor_type      text NOT NULL CHECK (actor_type IN ('TEAM', 'ADMIN')),
  team_id         uuid REFERENCES team(id),
  admin_id        uuid REFERENCES admin_user(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz,
  revoke_reason   text,
  user_agent      text,
  ip              text,
  CHECK ((actor_type = 'TEAM' AND team_id IS NOT NULL AND admin_id IS NULL) OR
         (actor_type = 'ADMIN' AND admin_id IS NOT NULL AND team_id IS NULL))
);
CREATE INDEX session_team_live ON session(team_id) WHERE revoked_at IS NULL;
CREATE INDEX session_admin_live ON session(admin_id) WHERE revoked_at IS NULL;

CREATE TABLE password_reset (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id           uuid NOT NULL REFERENCES team(id),
  token_hash        text NOT NULL UNIQUE,
  expires_at        timestamptz NOT NULL,
  used_at           timestamptz,
  created_by_admin  uuid REFERENCES admin_user(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);

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
-- Content library
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

CREATE TABLE problem (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,
  domain_id   uuid NOT NULL REFERENCES domain(id),
  kind        text NOT NULL CHECK (kind IN ('REGULAR', 'IMPOSTER')),
  title       text NOT NULL,
  archived    boolean NOT NULL DEFAULT false,
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE problem_version (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_id       uuid NOT NULL REFERENCES problem(id),
  version_no       int NOT NULL,
  status           text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  title            text NOT NULL,
  difficulty       text NOT NULL CHECK (difficulty IN ('EASY', 'MEDIUM', 'HARD')),
  statement        text NOT NULL,
  workspace        text NOT NULL,
  run_language     text CHECK (run_language IN ('javascript', 'python')),
  run_entry        text,
  files            jsonb NOT NULL,
  sample_stdin     text,
  answer_format    text NOT NULL,
  -- Server-only. For EXACT_TEXT the plaintext answer is removed and replaced by answer_verifier.
  validation       jsonb NOT NULL,
  answer_verifier  text,
  hint             text NOT NULL,
  solution         jsonb NOT NULL,
  reward           int NOT NULL CHECK (reward >= 0),
  hint_cost        int NOT NULL CHECK (hint_cost >= 0),
  source_template  text,
  source_variant   int,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  published_at     timestamptz,
  UNIQUE (problem_id, version_no)
);

-- A concrete, game-scoped instance of a published problem version.
CREATE TABLE task_instance (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id                  uuid NOT NULL REFERENCES game(id),
  sprint_id                uuid NOT NULL REFERENCES sprint(id),
  problem_version_id       uuid NOT NULL REFERENCES problem_version(id),
  domain_id                uuid NOT NULL REFERENCES domain(id),
  label                    text NOT NULL,
  generation               int NOT NULL DEFAULT 1,
  status                   text NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'SOLVED', 'DISABLED')),
  release_offset_seconds   int NOT NULL DEFAULT 0 CHECK (release_offset_seconds >= 0),
  close_offset_seconds     int CHECK (close_offset_seconds > 0),
  solved_by_enrollment_id  uuid REFERENCES game_enrollment(id),
  solved_at                timestamptz,
  version                  int NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sprint_id, label)
);
CREATE INDEX task_instance_game ON task_instance(game_id, sprint_id);

CREATE TABLE submission (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id              uuid NOT NULL REFERENCES game(id),
  enrollment_id        uuid NOT NULL REFERENCES game_enrollment(id),
  session_id           uuid,
  task_instance_id     uuid REFERENCES task_instance(id),
  imposter_release_id  uuid,
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
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_instance_id  uuid NOT NULL REFERENCES task_instance(id),
  generation        int NOT NULL,
  enrollment_id     uuid NOT NULL REFERENCES game_enrollment(id),
  submission_id     uuid NOT NULL REFERENCES submission(id),
  reward            int NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_instance_id, generation)
);

-- ---------------------------------------------------------------------------
-- IdeaCoins: immutable ledger + cached balances on game_enrollment
-- ---------------------------------------------------------------------------
CREATE TABLE coin_ledger (
  id              bigserial PRIMARY KEY,
  game_id         uuid NOT NULL REFERENCES game(id),
  enrollment_id   uuid NOT NULL REFERENCES game_enrollment(id),
  kind            text NOT NULL CHECK (kind IN ('SOLVE_REWARD', 'IMPOSTER_REWARD', 'HINT_PURCHASE', 'GRANT', 'ADJUSTMENT')),
  wallet_delta    int NOT NULL,
  earned_delta    int NOT NULL DEFAULT 0,
  spent_delta     int NOT NULL DEFAULT 0,
  grant_delta     int NOT NULL DEFAULT 0,
  score_delta     int NOT NULL DEFAULT 0,
  wallet_after    int NOT NULL,
  source_type     text NOT NULL,
  source_id       uuid NOT NULL,
  reason          text,
  actor_admin_id  uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id)
);
CREATE INDEX coin_ledger_enrollment ON coin_ledger(enrollment_id, id);

CREATE TABLE hint_purchase (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id             uuid NOT NULL REFERENCES game(id),
  enrollment_id       uuid NOT NULL REFERENCES game_enrollment(id),
  target_type         text NOT NULL CHECK (target_type IN ('TASK', 'IMPOSTER')),
  target_id           uuid NOT NULL,
  problem_version_id  uuid NOT NULL REFERENCES problem_version(id),
  cost                int NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, target_type, target_id, problem_version_id)
);

-- ---------------------------------------------------------------------------
-- Imposter (special) problems
-- ---------------------------------------------------------------------------
CREATE TABLE imposter_release (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id              uuid NOT NULL REFERENCES game(id),
  sprint_id            uuid NOT NULL REFERENCES sprint(id),
  problem_version_id   uuid NOT NULL REFERENCES problem_version(id),
  label                text NOT NULL,
  generation           int NOT NULL DEFAULT 1,
  status               text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'OFFERED', 'RESERVED', 'SOLVED', 'EXPIRED', 'CANCELLED')),
  mode                 text NOT NULL DEFAULT 'RESERVE' CHECK (mode IN ('RESERVE', 'OPEN')),
  reward               int NOT NULL CHECK (reward >= 0),
  hint_cost            int NOT NULL CHECK (hint_cost >= 0),
  claim_seconds        int NOT NULL CHECK (claim_seconds >= 5),
  solve_seconds        int NOT NULL CHECK (solve_seconds >= 15),
  released_at          timestamptz,
  claim_deadline_at    timestamptz,
  open_deadline_at     timestamptz,
  resolved_at          timestamptz,
  resolution_note      text,
  released_by          uuid,
  version              int NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL DEFAULT now()
);
-- At most one live imposter per game.
CREATE UNIQUE INDEX imposter_one_live_per_game ON imposter_release(game_id) WHERE status IN ('OFFERED', 'RESERVED');

CREATE TABLE imposter_reservation (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id         uuid NOT NULL UNIQUE REFERENCES imposter_release(id),
  enrollment_id      uuid NOT NULL REFERENCES game_enrollment(id),
  reserved_at        timestamptz NOT NULL,
  solve_deadline_at  timestamptz NOT NULL,
  status             text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SOLVED', 'EXPIRED', 'ABANDONED', 'CANCELLED')),
  resolved_at        timestamptz
);

-- ---------------------------------------------------------------------------
-- Rankings, elimination, disqualification, prizes, results
-- ---------------------------------------------------------------------------
CREATE TABLE ranking_snapshot (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id     uuid NOT NULL REFERENCES game(id),
  sprint_id   uuid REFERENCES sprint(id),
  metric      text NOT NULL,
  rows        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE elimination_batch (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id                   uuid NOT NULL REFERENCES game(id),
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
  game_id       uuid REFERENCES game(id),
  scope         text NOT NULL CHECK (scope IN ('GAME', 'EVENT')),
  reason        text NOT NULL,
  actor_id      uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  revoked_by    uuid,
  revoke_reason text,
  CHECK ((scope = 'GAME' AND game_id IS NOT NULL) OR (scope = 'EVENT' AND game_id IS NULL))
);

CREATE TABLE prize_rule (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id  uuid NOT NULL REFERENCES game(id),
  place    int NOT NULL CHECK (place >= 1),
  label    text NOT NULL,
  UNIQUE (game_id, place)
);

CREATE TABLE game_result (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id       uuid NOT NULL UNIQUE REFERENCES game(id),
  snapshot_id   uuid NOT NULL REFERENCES ranking_snapshot(id),
  rows          jsonb NOT NULL,
  resolution    jsonb NOT NULL,
  note          text,
  confirmed_by  uuid NOT NULL,
  confirmed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE announcement (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id     uuid REFERENCES game(id),
  message     text NOT NULL,
  kind        text NOT NULL DEFAULT 'INFO',
  actor_id    uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Code runs (non-scoring)
-- ---------------------------------------------------------------------------
CREATE TABLE run_job (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id        uuid NOT NULL REFERENCES game(id),
  enrollment_id  uuid NOT NULL REFERENCES game_enrollment(id),
  session_id     uuid,
  target_type    text NOT NULL,
  target_id      uuid NOT NULL,
  language       text NOT NULL,
  status         text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED')),
  result         jsonb,
  error          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz
);
CREATE INDEX run_job_enrollment ON run_job(enrollment_id, created_at);

-- ---------------------------------------------------------------------------
-- Audit, outbox, worker heartbeat
-- ---------------------------------------------------------------------------
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

-- Ledger and audit rows are append-only.
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;
CREATE TRIGGER coin_ledger_append_only BEFORE UPDATE OR DELETE ON coin_ledger FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Wake API dispatchers immediately when an outbox row commits.
CREATE FUNCTION outbox_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('outbox', NEW.id::text);
  RETURN NEW;
END $$;
CREATE TRIGGER outbox_event_notify AFTER INSERT ON outbox_event FOR EACH ROW EXECUTE FUNCTION outbox_notify();
