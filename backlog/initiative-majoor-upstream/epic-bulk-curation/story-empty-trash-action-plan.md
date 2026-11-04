---
title: 'Empty trash: permanently remove the files Majoor sent to the freedesktop trash'
type: 'feature'
ticket: '5'
created: '2026-11-04'
status: 'built'
route: 'full'
route_source: 'pinned'
review: 'thorough'
review_source: 'pinned'
lenses_ran: ['security']
review_loop_iteration: 3
followup_review_recommended: false
context: []
baseline_revision: '599b47dfc1657b28d73ddf62076942e02776e55c'
warnings: ['oversized']
deferred: []
branch: 'feat/empty-trash'
worktree: '/home/trumble/.paseo/worktrees/1ldb4s2k/feat-empty-trash'
design_open_questions: 'drafts/2.5-issue.md: scope (only entries whose original path is inside a Majoor root), Linux/BSD-only v1, placement. Built to the proposal; maintainer may redirect.'
---

<intent-contract>

## Intent

**Problem:** Majoor deletes through `send2trash` (`features/assets/delete_service.py:40-65`). On Linux
that lands files in the freedesktop trash (`<mount>/.Trash-<uid>/`, `<mount>/.Trash/<uid>/`, or
`$XDG_DATA_HOME/Trash`), and nothing in Majoor lists or clears it. Headless servers never empty it, so
curation never frees disk.

**Approach:** A backend trash service that finds, among the freedesktop trash directories relevant to
Majoor's roots, ONLY the entries whose original path (from `.trashinfo` `Path=`) lies inside a Majoor
root, reports their count/size, and permanently removes them on request. An "Empty trash" button in
the Status panel's maintenance actions shows the count and asks for confirmation.

## Boundaries & Constraints

**Always:**
- **Platform:** supported only on freedesktop platforms (`sys.platform` startswith `linux`, `freebsd`,
  `openbsd`, `netbsd`). Elsewhere `supported: false`, the POST refuses (`UNSUPPORTED`), the button is
  hidden.
- **Trash dirs scanned:** home trash `$XDG_DATA_HOME/Trash` (default `~/.local/share/Trash`; topdir =
  `$XDG_DATA_HOME`), and for each Majoor root (output, input, custom roots — the same runtime enumeration
  the path guards use) its mount point's `<topdir>/.Trash/<uid>` (only when `<topdir>/.Trash` is a real
  directory, not a symlink, with the sticky bit) and `<topdir>/.Trash-<uid>`. `uid = os.getuid()`.
  Deduplicate by real path. Skip any trash dir, `files/` or `info/` that is a symlink.
- **Entry selection:** for each `info/*.trashinfo` that is a regular file (lstat): parse `[Trash Info]`
  `Path=`, `urllib.parse.unquote` it, resolve a relative path against the trash dir's topdir, normalise
  lexically (`os.path.normpath` on an absolute path; the original no longer exists, so no strict resolve),
  and select it only if it is inside one of the resolved Majoor roots (path-component containment, not
  string prefix). The entry's payload is `files/<info basename minus ".trashinfo">`. Malformed, missing
  `Path=`, or outside-root entries are ignored (never removed). Orphan `files/` entries without a
  trashinfo are never removed.
- **Removal:** re-`lstat` the payload: regular file or symlink → `os.unlink` (never follow); real
  directory → `shutil.rmtree` on it (it refuses symlinks; walk without following); missing → skip
  payload; then unlink the `.trashinfo`. `FileNotFoundError` anywhere is tolerated (concurrent
  expiry). Any other `OSError` on an entry → recorded in `failed` and the entry left as is; continue. No
  fallback that could touch anything else.
- **Routes:** `GET /mjr/am/trash` → `{supported, count, bytes}` (no paths in the response), requires write
  access like other maintenance status GETs. `POST /mjr/am/trash/empty` → `{removed, bytes, failed:
  [{name, error}]}`; CSRF + write access + operation gate + rate limit (3 / 60 s) + one audit entry
  (counts only). Operation name `trash_empty` is added to the existing delete gate tuple in
  `routes/core/security_policy.py` (`("delete","asset_delete","assets_delete")` → `allow_delete` /
  `MAJOOR_ALLOW_DELETE`), so emptying is disabled exactly when deleting is.
- **UI:** "Empty trash" button in the Status panel actions row (`ui/features/status/StatusDot.ts`
  actionsRow, beside Reset index), hidden when unsupported, disabled with a tooltip when delete is
  disabled (same pattern as Reset index). Click → GET; count 0 → info toast "Trash is empty"; else
  confirm "Permanently delete N trashed files (size) that came from Majoor's folders? This cannot be undone." (selection is by original location, so files trashed from those folders by other tools are included — say so in docs/DB_MAINTENANCE.md) →
  POST → result toast (and failures count). Uses existing `comfyConfirm` / toast helpers.
- **Tests:** backend service at 100% line+branch coverage (security-critical convention,
  `docs/CONTRIBUTING.md:235`) with synthetic trash trees in `tmp_path` and monkeypatched home/uid/platform;
  security tests in `tests/security/`; route tests; Vitest for the button flow.
- **Docs:** `docs/DB_MAINTENANCE.md` (Status panel buttons), `docs/API_REFERENCE.md`,
  `docs/SECURITY_ENV_VARS.md` (MAJOOR_ALLOW_DELETE also gates empty trash), `CHANGELOG.md`. Final separate
  `chore(dist): rebuild`.

**Never:** No change to how delete trashes files. Never remove an entry whose original path is outside the
roots, an orphan, or anything reached through a symlink. No Windows/macOS implementation. No scheduled
expiry. No paths in GET responses or audit details. No reformatting of pre-existing lines. Never run
node/npm on the host.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Inside root | `.Trash-1000/info/a.png.trashinfo` Path=`out/a.png` (relative to topdir, under root) + `files/a.png` | counted; emptied → both removed | none |
| Absolute + encoded | home trash, Path=`/roots/out/my%20cat%202.png`, files `my cat 2.png` | selected and removed | none |
| Outside roots | Path=`/etc/passwd` or `/other/app/x.png` | ignored, untouched | none |
| Traversal | Path=`out/../../etc/x` (relative) | normalises outside root → ignored | none |
| Malformed | no `[Trash Info]`/no `Path=`/binary | ignored | none |
| Orphan | `files/z.png` with no trashinfo | untouched | none |
| Symlink payload | `files/a.png` → symlink to `/outside/keep.png` | symlink unlinked, target untouched | none |
| Symlink trash dir | `.Trash-1000` is a symlink | dir skipped | none |
| `.Trash` not sticky / symlink | `<topdir>/.Trash/1000` exists but `.Trash` lacks sticky bit or is a symlink | that dir skipped | none |
| Directory payload | `files/d/` real dir, Path inside root | rmtree'd, info removed | none |
| Race | payload vanishes between scan and remove | info removed, counted removed (or skipped), no error | tolerated |
| Permission | unlink raises PermissionError | entry in `failed`, others proceed | reported |
| Dedupe | two roots on same mount | one `.Trash-<uid>` scanned once | none |
| Unsupported | `sys.platform == "win32"` | GET supported:false; POST `UNSUPPORTED` | no work |
| Gate | delete disabled | POST refused by operation gate | no work |
| UI | count 3 → confirm → POST ok removed 3 | toast "3 files removed" | warn toast if failed>0 |
| UI empty | count 0 | toast "Trash is empty", no confirm, no POST | none |

</intent-contract>

## Code Map

- New `mjr_am_backend/features/assets/trash_service.py` -- `is_supported()`, `trash_dirs(roots)`,
  `scan(roots) -> TrashScan(count, bytes, entries)`, `empty(roots) -> Result[{removed, bytes, failed}]`.
  Pure filesystem; inject `home`, `uid`, `platform`, `xdg_data_home` for tests.
- Roots: output `config.py:327` `get_runtime_output_root()`, input `adapters/comfy_core.py:627`
  `get_input_directory()`, custom `custom_roots.py:211` `list_custom_roots()`; the allowlist builder
  `routes/core/paths.py:31-59` `_get_allowed_directories()` — reuse it rather than re-enumerating.
- New routes in `mjr_am_backend/routes/handlers/db_maintenance.py` (pattern `db_backup_save` :1207-1263;
  guarded GET `:1184-1195`) or a small new handler module registered via `routes/route_catalog.py:54-139`
  / `routes/registry.py:128-175`. Rate limit via the existing `_check_rate_limit` helper.
- `mjr_am_backend/routes/core/security_policy.py:144-149` -- add `"trash_empty"` to the delete gate tuple.
- `ui/features/status/StatusDot.ts:696-823` -- actionsRow + Reset index button pattern (gate tooltip
  :737-740); `ui/app/DialogTemplates.ts:174` `comfyConfirm`; `ui/api/endpoints.ts` + a client function.
- Tests: `tests/routes/test_assets_path_guard.py` (fake send2trash via `sys.modules`), `tests/security/`
  (style of `test_offensive_security.py`), route tests in the db-maintenance test file; UI
  `ui/tests/*.vitest.ts`.
- Reference semantics: freedesktop/send2trash (`.trashinfo` Path= percent-encoded, relative to topdir when
  under it; collision names `foo 2.png`); ysalune `comfyui-trash-expire.sh` (space-safe removal).

## Tasks & Acceptance

**Execution:**
- [ ] `trash_service.py` + unit tests (100% coverage of the module).
- [ ] security tests (`tests/security/test_trash_empty.py`) for outside-root, traversal, symlink payload, symlinked dirs, non-sticky `.Trash`, malformed.
- [ ] routes + gate + audit + route tests.
- [ ] Status panel button + client + Vitest.
- [ ] docs + CHANGELOG; final `chore(dist): rebuild`.

**Acceptance Criteria:**
- Given a trash dir holding 3 Majoor-originated entries and 2 foreign entries, when the user clicks Empty trash and confirms, then exactly the 3 Majoor entries (payload + trashinfo) are gone and the 2 foreign entries are byte-identical.
- Given `MAJOOR_ALLOW_DELETE` unset (delete disabled), when POST /mjr/am/trash/empty is called, then it is refused and nothing is removed.

## Implementation Notes

- Built by GLM-5.3 sub-agent (Paseo) in worktree `feat-empty-trash`; synthetic trash trees under tmp_path only; tests first (ImportError on main).
- Design changed twice under review (see Plan Change Log): crafted-basename guard; then ownership/mode checks, fd-relative O_NOFOLLOW removal, directory payloads skipped (no rmtree), NUL-safe per-entry handling, GET rate limit; then off-loop scan and O_NOFOLLOW info open.
- `trash_service.py` at 100% line+branch coverage (278 stmts / 86 branches).
- One pass reformatted ~12 unrelated i18n.ts lines; reverted (diff is additions only). The gate now warns when an edited file's Prettier drift drops.
- Residual (accepted, not deferred): intermediate path components are not O_NOFOLLOW; the fstat ownership re-check confines any redirect to a uid-owned trash-shaped tree, removing only REG/LNK entries by bare name — verified by the second security pass.

## Plan Change Log

### 2026-11-04 — amendments from orchestrator review
- **Trigger:** crafted info basenames (`.trashinfo`, `..trashinfo`, `...trashinfo`) made the payload `files/` or the trash dir → rmtree of everything (HIGH). **Amended:** payload stem validated; payload parent must be `files/`. Also: lexical+realpath root matching (symlinked root prefixes), 64 KiB trashinfo read cap.

### 2026-11-04 — amendments from adversarial security review
- **Trigger 1 (HIGH):** per-uid trash dirs accepted without ownership/mode checks → on a world-writable mount another user can plant `.Trash-<uid>` (or a self-made sticky `.Trash/<uid>`). **Amended:** a trash dir (and its `files/`, `info/`) is used only if owned by `uid` and not group/world-writable (`mode & 0o022 == 0`); `.Trash` parent must be a real dir with the sticky bit (owner unrestricted, per spec) and `.Trash/<uid>` owned by `uid`. Home trash gets the same ownership/mode check.
- **Trigger 2 (HIGH):** path-based removal after one-shot validation → `files/`/`info/` swapped for symlinks between scan and unlink = arbitrary file deletion. **Amended:** directory payloads are NOT removed (Majoor only ever trashes files; such entries are skipped and reported in `skipped_dirs`) — removes `shutil.rmtree` entirely. Removal opens the trash dir, then `files/` and `info/` with `O_RDONLY|O_DIRECTORY|O_NOFOLLOW` relative to the parent fd, re-checks ownership/mode via `fstat`, `os.lstat(stem, dir_fd=files_fd)` must be a regular file or symlink, then `os.unlink(stem, dir_fd=files_fd)` and `os.unlink(info_name, dir_fd=info_fd)`. No path-based unlink remains.
- **Trigger 3 (MEDIUM):** NUL in `Path=` raised `ValueError` past the per-entry handling → whole scan fails. **Amended:** reject `Path=` containing NUL; per-entry evaluation catches `(OSError, ValueError)` and skips the entry.
- **Trigger 4 (MEDIUM):** GET recursively sized directory payloads, unbounded, no rate limit. **Amended:** no recursion (directories skipped); GET rate-limited (20/60 s).
- Payload-stem sub-guards unreachable via real scandir are kept as defence-in-depth and tested by calling `_entry_from_info` with a fake DirEntry.
- **KEEP:** selection-by-original-location semantics, root enumeration, platform gate, `trash_empty` on the delete gate, POST guard order, audit (counts only), UI flow and wording, 100% coverage of the service.

## Review Triage Log

### 2026-11-04 — Review pass 1 (orchestrator)
- verdicts: 3 findings — high 1, medium 1, low 1
- findings:
  - `[high]` `[bad_plan]` crafted info basenames (`.trashinfo`, `..trashinfo`, `...trashinfo`) made the payload `files/` or the trash dir → rmtree everything — stem validation + parent check; plan amended; security tests.
  - `[medium]` `[patch]` symlinked root prefixes never matched → Majoor entries silently never cleaned — lexical+realpath root matching.
  - `[low]` `[patch]` unbounded trashinfo read — 64 KiB cap.

### 2026-11-04 — Review pass 2 (adversarial security lens)
- verdicts: 5 findings — high 2, medium 2, low 1
- findings:
  - `[high]` `[bad_plan]` no ownership/mode validation → planted `.Trash-<uid>` on world-writable mounts — owner==uid and no group/world write on trash dir, files/, info/; plan amended.
  - `[high]` `[bad_plan]` path-based removal after one-shot validation → symlink-swap arbitrary deletion — fd-relative O_NOFOLLOW removal with fstat re-checks; directory payloads skipped (rmtree removed); plan amended.
  - `[medium]` `[patch]` NUL in Path= aborted the whole scan — rejected; per-entry (OSError, ValueError) handling.
  - `[medium]` `[patch]` GET did unbounded recursive sizing with no rate limit — no recursion; GET 20/60 s.
  - `[low]` `[patch]` stem sub-guards untested — tested via fake DirEntry.

### 2026-11-04 — Review pass 3 (adversarial security follow-up)
- verdicts: 3 findings — medium 1, low 1, false 1
- findings:
  - `[medium]` `[patch]` GET (and root enumeration for both routes) ran on the event loop — moved to `asyncio.to_thread`.
  - `[low]` `[patch]` trashinfo open followed a swapped-in symlink — O_NOFOLLOW open; test.
  - `[false]` `[reject]` i18n.ts reformatting — already reverted before this pass (reviewer read a stale diff; branch diff is additions only).

## Verification

Python: `uv venv -p 3.12 .venv && uv pip install --python .venv/bin/python -r requirements-dev.txt`. Node ONLY via `sh /tmp/majoor-gate/node.sh <worktree> <cmd...>`.

**Commands:**
- `.venv/bin/python -m pytest tests -q -k trash --cov=mjr_am_backend.features.assets.trash_service --cov-branch --cov-report=term-missing` -- expected: pass, 100% for trash_service
- `.venv/bin/python -m pytest tests -q` -- no new failures
- `.venv/bin/python -m ruff check <changed>`; `.venv/bin/python -m mypy --config-file mypy.ini`; `.venv/bin/python -m bandit -r mjr_am_backend -ll -ii -x tests` -- clean
- `sh /tmp/majoor-gate/node.sh $PWD npx vitest run` -- all pass; Prettier drift on edited UI files ≤ upstream/main
- `sh /tmp/majoor-gate/node.sh $PWD npm run build` -- succeeds

## Auto Run Result

- **Summary:** "Empty trash" in the Status panel (Linux/BSD only) permanently removes the freedesktop trash entries whose original location lies inside a Majoor root — home trash and per-mount `.Trash-<uid>` / sticky `.Trash/<uid>`, owner- and mode-checked, removal by fd with O_NOFOLLOW, files only (directories skipped), foreign/orphan/malformed entries never touched. `GET /mjr/am/trash` → `{supported, count, bytes}` (20/60 s); `POST /mjr/am/trash/empty` (CSRF, write access, `trash_empty` on the delete gate so it is off whenever delete is, 3/60 s, audit counts only). Confirm dialog with count and size; scan and empty run off the event loop.
- **Branch:** `feat/empty-trash` @ 2348f2a2 (service 8485791c, api 265f42d6, ui 72ac8013, docs 645dbc94, chore(dist) 2348f2a2) off upstream/main 599b47df. Nothing posted upstream.
- **Files:** `mjr_am_backend/features/assets/trash_service.py` (new), `routes/handlers/db_maintenance.py`, `routes/core/security_policy.py`; `ui/features/status/emptyTrashAction.ts` (new), `StatusDot.ts`, `ui/api/clientOps.ts`, `ui/api/endpoints.ts`, `ui/app/i18n.ts`; tests `tests/features/test_trash_service.py`, `tests/security/test_trash_empty.py`, route tests, `ui/tests/empty_trash_action.vitest.ts`; docs `API_REFERENCE.md`, `DB_MAINTENANCE.md`, `SECURITY_ENV_VARS.md`; `CHANGELOG.md`; `dist/`.
- **Review:** 3 passes (1 orchestrator, 2 adversarial security); 9 patches (3 high via plan amendments, 4 medium, 2 low), 1 rejected. Converged: final security pass verified all fixes, no high/medium open.
- **Verification:** full gate in `node:24-bookworm`: pytest 2043 passed; Vitest 869 passed; Ruff/Mypy/Bandit/Xenon/ESLint/npm audit clean; no Prettier drift change; trash_service 100% line+branch.
- **Open design questions (for the maintainer):** scope by original location, Linux/BSD-only v1, placement — `drafts/2.5-issue.md`.
