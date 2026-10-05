# Import formats

Samples live in [`samples/`](../samples). Every import is **preview → (fix / map) → explicit
Commit**. Previews write only an `import_batch` row; nothing else changes until you commit.
Commit re-validates against current data and is idempotent: committing the same preview twice
returns the first result.

Limits: 2 MB per file, 2,000 data rows. Only `.csv` and `.xlsx` are accepted; the extension and
the file's magic bytes must agree. XLSX formulas are read as their cached values, never evaluated.

## Teams (CSV / XLSX)

Console → **Import**, or `POST /api/v1/admin/teams/imports` with `{ fileName, contentBase64, mapping? }`,
then `POST /api/v1/admin/teams/imports/:batchId/commit`.
Templates: `GET /api/v1/admin/teams/import-template?format=csv|xlsx`.

| Column | Required | Notes |
|---|---|---|
| `team_name` | yes | 2–40 characters: letters, digits, space and `. _ & ' -`. Unique per event (case / space insensitive). |
| `crew_id` | no | `CRW-NNN`. Leave empty for new crews: ids are allocated from a sequence and **never reused**. If you give one, it identifies an existing crew. |
| `captain_email` | yes | Login identifier; unique per event. |
| `member1_name` … `member4_name` | 3 or 4 members | `member1` is the captain. |
| `memberN_institution`, `memberN_year`, `memberN_branch`, `memberN_student_id` | no | |
| `slot` | no | `1`–`4` (or "Slot 2"). Empty = unassigned (assign later in bulk). |
| `account_enabled` | no | true/false/yes/no/1/0 (default true). |
| `checked_in` | no | same values (default false). |

Header matching ignores case, spaces and underscores, and accepts aliases (`Team Name`, `Email`,
`Captain`, `Slot Number`, …). Anything else can be mapped explicitly: the preview shows a column
mapping editor (`mapping: { canonical_column: "File header" }`).

**Identity on re-import:** a row matches an existing crew by `crew_id` first, then by captain
email. Matching rows become **UPDATE** (with the list of changes) or **UNCHANGED**. Re-imports
never touch passwords, sessions, wallets or history. Disabling an account through an import
signs its devices out.

**Row errors** (shown per row; commit is refused while any exist):
- missing or invalid fields;
- fewer than 3 or more than 4 members;
- a duplicate team name, email or crew id, either in the file or against existing crews;
- an unknown slot or bad booleans;
- an email that belongs to a different crew id;
- a slot change for a crew that has **already scored** ("Slot change blocked … audited
  correction"). See [DECISIONS](DECISIONS.md).

**Capacity:** the preview shows each slot's load after the import. Commit is refused when a
slot would exceed its capacity (default 10). Raise the capacity in Slots first if you really
mean it.

Sample files:
- `teams-sample.csv`: 3 valid crews (one with quoted, comma-containing institutions), unassigned.
- `teams-sample.xlsx`: the same crews with aliased headers (`Team Name`, `Captain Email`,
  `Captain`). Re-importing it after the CSV gives **3 × UNCHANGED**.
- `teams-invalid.csv`: one error of each kind on rows 3–10 (row 2 is valid). Used by the tests.
- Regenerate the XLSX with `npx tsx ../samples/make-xlsx.mts` (run from `server/`).

## Credentials

Importing **never** sends anything. Console → Crews → select → **Send credentials**:
1. Preview (`POST /api/v1/admin/credential-deliveries/preview`) shows the channel, the recipients
   with warnings (disabled, no slot, already has credentials) and a sample mail with the password
   masked.
2. Send (`POST /api/v1/admin/credential-deliveries` with `confirm: true`). For each crew this
   generates a new temporary password server-side, sets *must change password*, signs out old
   devices, and records a delivery row (no password stored).

| `MAIL_MODE` | Behaviour |
|---|---|
| `capture` (demo default) | Stored in the console's **Demo mail inbox**, labelled "demo mail, not delivered externally". Status CAPTURED. |
| `smtp` + `SMTP_URL` | Sent via SMTP. Status SENT only when the server accepted it; failures are recorded as FAILED and the old credentials stay valid. With `MAIL_SINK=true` (e.g. Mailpit in Docker Compose) the console says the mail was caught locally, and the crew stays ISSUED rather than DELIVERED. |
| `none` (production default) | Sending is refused with `MAIL_NOT_CONFIGURED`. |

## Question bank (JSON, CSV, XLSX)

Console → Question bank → Import, or `POST /api/v1/admin/questions/imports` with
`{ fileName, contentBase64, assets? }`, then `…/imports/:batchId/commit`.
Imports create **DRAFT** versions only. Publishing is a separate, explicit
DRAFT → REVIEWED → PUBLISHED flow. Only PUBLISHED versions can be planned or released.

**JSON** (`questions-sample.json`) is the full format: `{ "questions": [ QuestionInput, … ] }`
where `QuestionInput` is:

```jsonc
{
  "key": "sample-basic-fuel-sum",          // optional, unique, lowercase-dashes
  "domain": "web|data|ds|basic|design|misc",
  "pool": "REGULAR|BONUS",
  "title": "…", "difficulty": "EASY|MEDIUM|HARD",
  "statement": "…",                         // ≥ 20 chars
  "workspace": "WEB|DATA|DS|BASIC|DESIGN|MISC",
  "runLanguage": "javascript|python|null", "runEntry": "file name when runLanguage is set",
  "files": [{ "name": "fuel.py", "language": "python", "content": "…", "readOnly": false }],
  "sampleStdin": "…", "answerFormat": "what to submit",
  "validation":
      { "mode": "EXACT_TEXT", "answer": "…", "caseSensitive": false, "collapseWhitespace": true }
    | { "mode": "NUMERIC", "answer": 20.5, "tolerance": 0.05 }
    | { "mode": "CODE_TESTS", "language": "python", "entry": "fuel.py", "tests": [{ "name": "…", "stdin": "…", "expected": "…" }], "harness": [] },
  "hint": "…",                              // sold for the rule's hint cost
  "solutionExplanation": "private walkthrough (required)",
  "solutionFiles": { "fuel.py": "…" },      // for code questions
  "solutionAnswer": "…"                     // for typed answers
}
```

Exact-text answers are stored only as HMAC verifiers. Hidden tests and solutions never reach
participants.

**CSV / XLSX** (`questions-sample.csv`) carry typed-answer questions:
- columns `key, domain, pool, difficulty, title, statement, workspace, validation_mode, answer,
  tolerance, case_sensitive, answer_format, hint, solution, files, run_language, run_entry`;
- `files` lists asset file names (`;` or `,` separated). Upload those files alongside as
  `assets: { "o2-readings.csv": "<text>" }`. A missing asset is a row error;
- `CODE_TESTS` needs the JSON format (hidden tests).

After import: open each draft → **Verify** (runs the private solution and the buggy starter
through the real runner / validator) → mark REVIEWED → PUBLISHED.
