-- Question bank from the IDEALab.dev repository (flag-based CTF problems).
--  runtime : SERVER-ONLY execution context (hidden python setup / validation, virtual
--            filesystem for the terminal, SQL tables, expected JSON state). Never sent to crews.
--  board   : visible evidence board (text / html / sequence).
--  hints   : paid hint ladder [{level, cost, text}] (bought in order).
--  source  : provenance, e.g. {"repo": "...", "id": "core_compute_01", "commit": "..."}.
ALTER TABLE question_version ADD COLUMN runtime jsonb;
ALTER TABLE question_version ADD COLUMN board jsonb;
ALTER TABLE question_version ADD COLUMN hints jsonb;
ALTER TABLE question_version ADD COLUMN source jsonb;

-- Hint ladders: one purchase per level.
ALTER TABLE hint_purchase ADD COLUMN level int NOT NULL DEFAULT 1 CHECK (level >= 1);
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint WHERE conrelid = 'hint_purchase'::regclass AND contype = 'u';
  IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE hint_purchase DROP CONSTRAINT %I', c); END IF;
END $$;
ALTER TABLE hint_purchase ADD CONSTRAINT hint_purchase_level_unique UNIQUE (enrollment_id, instance_id, question_version_id, level);

-- Bank queries by domain / difficulty / status.
CREATE INDEX question_version_lookup ON question_version(status, difficulty);
CREATE INDEX question_instance_version ON question_instance(question_version_id);
