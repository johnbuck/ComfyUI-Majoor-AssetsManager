---
title: 'Recursive scan skips hidden and Majoor-internal folders'
type: 'bugfix'
ticket: '1'
created: '2026-11-03'
status: 'in-progress'
route: 'full'
route_source: 'pinned'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: false
context: []
baseline_revision: '599b47dfc1657b28d73ddf62076942e02776e55c'
warnings: []
deferred: []
branch: 'fix/scan-skip-hidden-dirs'
worktree: '/home/trumble/.paseo/worktrees/1ldb4s2k/fix-scan-skip-hidden-dirs'
---

<intent-contract>

## Intent

**Problem:** On upstream/main (verified 2026-11-03 at 599b47df) `FileSystemWalker._next_dir` returns every
subdirectory, so a recursive scan descends into `.Trash-<uid>/files` (send2trash's per-volume trash, which
Majoor's own delete fills) and `_mjr_index`, and trashed images reappear as live cards. The watcher
already ignores internal folders; the scan walker does not.

**Approach:** The recursive walker never descends into a subdirectory whose name starts with `.` or whose
lowercased name is in the internal-folder set. One shared set of names serves both walker and watcher.

## Boundaries & Constraints

**Always:** Apply the rule only to directories found *below* the scan root (the root itself may sit under
a dot-path such as `~/.config/ComfyUI/output` and must still scan, see watcher MED-04 comment). Keep
symlinked-dir behaviour unchanged. Black 100 cols, Ruff, MyPy/Pyright clean. Synthetic fixtures only.

**Never:** Do not change file-level filtering (`_candidate`), the non-recursive path, the browser
service, or the watcher's matching logic. No new env knobs. No homelab references in code, comments,
tests, or commit text (no "YSALUNE", no staging counts).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Trash folder | root/.Trash-1000/files/a.png + root/b.png, recursive | only b.png yielded | none |
| Internal folder | root/_mjr_index/x.png, root/__pycache__/y.png, recursive | neither yielded | none |
| Case-insensitive internal name | root/_MJR_Index/x.png, recursive | not yielded | none |
| Normal nested folder | root/sub/c.png, recursive | c.png yielded (regression) | none |
| Dot-path root | root is tmp/.hidden_root containing d.png, recursive | d.png yielded | none |
| Dot-prefixed file at root | root/.e.png (file, not dir) | unchanged from current behaviour | none |

</intent-contract>

## Code Map

- `mjr_am_backend/features/index/fs_walker.py:207` -- `_next_dir(entry)`: the only place the recursive
  walk decides to descend; add the name check here. Module has no watchdog dependency, so it is the
  right home for the shared constant.
- `mjr_am_backend/features/index/watcher.py:97` -- `IGNORED_DIRS` set (`_mjr_index`, `.majoor`,
  `__pycache__`, `.git`, `node_modules`, `.thumbs`, `.cache`). Move the definition to fs_walker
  (e.g. `IGNORED_DIR_NAMES`) and keep the name `IGNORED_DIRS` in watcher as an import alias so
  `_is_ignored_path` and any external reference keep working.
- `tests/features/test_index_fs_walker.py` -- existing walker tests (tmp_path fixtures,
  `FileSystemWalker(scan_iops_limit=0.0)`); add the matrix tests here.
- `CHANGELOG.md` -- add a Fixed entry under `## [Unreleased]`, matching existing entry style.

## Tasks & Acceptance

**Execution:**
- [ ] `mjr_am_backend/features/index/fs_walker.py` -- add shared `IGNORED_DIR_NAMES` frozenset and a
  hidden/internal-name check in `_next_dir` -- the actual fix.
- [ ] `mjr_am_backend/features/index/watcher.py` -- replace the local set with an import of the shared
  one, aliased `IGNORED_DIRS` -- single source of truth, no behaviour change for the watcher.
- [ ] `tests/features/test_index_fs_walker.py` -- one test per matrix row -- the trash/internal tests
  must fail on unpatched main.
- [ ] `CHANGELOG.md` -- Unreleased Fixed entry.

**Acceptance Criteria:**
- Given an output root containing `.Trash-1000/files/*.png`, when a recursive scan walks it, then no
  file under the trash folder is yielded by `iter_files`.
- Given the new tests, when run against unpatched upstream/main, then the trash and internal-folder
  tests fail.
- Given the full Python suite, when run after the change, then no previously passing test fails.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Verification

All commands run in the worktree on Python 3.12 (`uv venv -p 3.12 .venv && uv pip install -r requirements-dev.txt`):

**Commands:**
- `.venv/bin/python -m pytest tests/features/test_index_fs_walker.py tests/features/test_index_fs_walker_more.py -q` -- expected: all pass
- `.venv/bin/python -m pytest tests -q -x -p no:cacheprovider` -- expected: no new failures vs baseline
- `.venv/bin/python -m ruff check mjr_am_backend tests && .venv/bin/python -m black --check -l 100 mjr_am_backend/features/index tests/features/test_index_fs_walker.py` -- expected: clean
- Full gate (`npm run quality`) is run by the orchestrator in the node:24-bookworm container.
