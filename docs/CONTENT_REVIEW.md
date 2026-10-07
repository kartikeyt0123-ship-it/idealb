# Question bank — IDEALab.dev

The competition bank is the organizers' repository
**https://github.com/Idealab-Sgsits/IDEALab.dev** (`data/<domain>.json`).
- **Size:** 360 flag-based problems, 60 per domain (25 easy / 20 medium / 15 hard).
- **Snapshot:** commit `f406d64` is bundled in `server/src/content/idealab/` (`SOURCE.json` records
  the commit). The demo seed loads it, and it is the offline fallback for **Question bank → Sync
  from GitHub**.
- **Answers:** every problem is answered with a **flag** (case-insensitive; `FLAG: X` and
  `flag{X}` wrappers are accepted).

## How the repository format is used

| Domain (station) | Repository fields | AMONG BUG workspace |
|---|---|---|
| Core Compute (`core_compute`) | `editor_state.visible_code`, `hidden_validation_b64` | Python editor. **Run** = the crew's code + the hidden check, which prints `FLAG: …` once the bug is fixed. |
| Data Decypher (`data_decypher`) | `visible_code`, `hidden_setup(_b64)`, `hidden_validation`, `output_type` | Python editor with the hidden dataset pre-loaded (numpy / pandas available). `plot` questions return the matplotlib figure as an image. |
| Maker Sandbox (`maker`) | micropython: `visible_code` / `hidden_setup` / `hidden_validation`; `json_tweak`: `initial_state` / `expected_state_b64` / `visual_render_b64`; `api_intercept`: `initial_payload` / `expected_payload` / `endpoint` | Python editor, or a **JSON editor + Apply**. The server compares the edited JSON with the expected state and shows the device (bulb / padlock) and the success message with the flag. |
| Cryptography (`cryptography`) | `evidence_board {type: text / html / sequence, content}` | Evidence board (html rendered in a script-less sandbox) + flag field. |
| Reconnaissance (`recon`) | bash / forensic / network: `file_system_b64`, `current_directory`, `current_user`, `initial_command`; sql: `database_schema_b64`, `default_query`; osint: `evidence_board` | **Terminal** over the virtual filesystem (server-side shell, see below), **SQL editor** (SQLite in the runner), or evidence board. |
| Web Exploitation (`web`) | `editor_state.files {path: {content, is_editable, is_visible}}`, `active_file` | Web editor + live sandboxed preview. Non-visible files are preview-only (not shown as tabs). Console output and `alert()` are shown in the preview console. |

**Hidden material is server-only:**
- What it covers: setup code, validation code, filesystems, tables and expected states.
- Python checks are passed to the runner through stdin, never as a readable file.
- The literal flag in a check is replaced by a random per-run marker, which the server swaps back
  only in the output.
- Reading `__file__` or stdin from the crew's code does not reveal the flag (covered by a test).
- **Exception — web preview files:** these are sent to the browser because the preview needs them,
  so a determined crew with devtools can read them. Content protection blocks the devtools shortcuts
  (best effort).

### Terminal (Reconnaissance)

A deterministic, in-process shell over the question's files; nothing touches the real OS.

- **Syntax:**
  - pipes and sequences: `|`, `;`, `&&`;
  - quotes, `$VAR`, `~`, globs, `>` (session only).
- **Commands:**
  - files and navigation: `ls cd pwd cat head tail file stat du history`;
  - search and text: `grep (-i -v -n -r -o -c -E -w -A -B -C) find (-name -type -size -empty -path) wc sort uniq cut tr rev strings`;
  - encoding and dumps: `base64 -d`, `xxd`, `hexdump`;
  - scripting: `awk` (a safe interpreted subset: patterns, `print`, `printf`, `+=`, `END`), `sed s///`, `xargs`, `echo printf`;
  - system: `env export whoami id`, `curl` (answers from `mock_response.txt`), `ss` / `netstat`.
- **Bank conventions:**
  - files live in the starting directory;
  - `env_dump.txt` provides environment variables;
  - a missing absolute path falls back to the file with the same name.

## Automated check

```bash
npm run build -w runner
npm run bank:check -w server              # bundled snapshot
npm run bank:check -w server -- --github  # straight from GitHub (main)
npm run bank:check -w server -- --notes   # also list informational notes
```

For every question it verifies:
- **Python:** the hidden setup and the starter run without missing libraries, and the untouched
  starter does not already print the flag.
- **SQL:** the default query runs, and the flag is in the tables.
- **Terminal:** the flag is discoverable, and every command quoted in a hint is supported.
- **JSON:** the expected state is accepted and reveals the flag.
- **Web:** `index.html` exists.
- **Evidence:** the board is not empty.

The repository has no reference solutions, so the intended fix itself cannot be proven.

**Last run (snapshot `f406d64`): 360 checked, 1 problem, 12 notes.**

### Issues found in the repository data (please fix upstream)

| Question | Issue | What AMONG BUG does |
|---|---|---|
| `core_compute_21` (Two-sum) | The unfixed code already ends with `found_pair = [8, 2]`, so the check passes and Run prints the flag without any fix. | Reported only; avoid it, or change its check upstream. |
| `maker_41` – `maker_60` | The hidden check recomputes the answer itself and never reads the participant's code, so Run on the empty starter would print the flag. | **Gated automatically:** the flag is shown only if the participant's own output contains a value the check computed ("Your printed result is not the expected one yet" otherwise). |
| `recon_60` | `vault_stage1.txt` decodes to `ERONA_FTAGT_FOYI_v0`, which cannot become `RECON_STAGE_SOLVE_60` with the described base64 → reverse → rot13 pipeline. | Reported; avoid it until fixed. |
| `recon_44` | Its data defines a table called `sqlite_master` (reserved in SQLite). | The real SQLite catalogue is used; the tables it lists are created, so the intended query works. |

Notes (expected, not errors):
- `core_compute_01` and `core_compute_23` are infinite loops until fixed.
- 5 data questions are plotting tasks: the starter draws nothing yet.
- `recon_27` / `recon_30` flags are computed or decoded in the terminal.
- `web_27` / `web_29` are keyboard puzzles with no editable file.

## Bank workflow

- **Sync from GitHub** (Question bank tab) previews NEW / CHANGED / UNCHANGED questions by
  repository id, then commits:
  - new ones are created;
  - changed ones get a new version (status DRAFT, or PUBLISHED when you tick *Publish
    immediately*);
  - instances already released keep the version they were released with.
- Only PUBLISHED questions can be planned or released. **Previously used questions can be released
  again** in later sprints and slots. The auto-picker prefers questions new to the slot, then the
  least used.
- **Legacy content:** the seedable demo templates (`server/src/content/templates`, checked by
  `npm run content:check`) and JSON / CSV imports still work for extra questions. Use the six
  IDEALab domain slugs.
