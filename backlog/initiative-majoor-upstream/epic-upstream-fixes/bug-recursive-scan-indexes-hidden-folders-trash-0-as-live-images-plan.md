---
title: 'Recursive scan skips hidden and Majoor-internal folders'
type: 'bugfix'
ticket: '1'
created: '2026-11-03'
status: done
route: 'full'
route_source: 'pinned'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
followup_review_recommended: false
context: []
baseline_revision: '599b47dfc1657b28d73ddf62076942e02776e55c'
warnings: []
deferred: []
upstream_issue: 'https://github.com/MajoorWaldi/ComfyUI-Majoor-AssetsManager/issues/271'
upstream_pr: 'https://github.com/MajoorWaldi/ComfyUI-Majoor-AssetsManager/pull/274'
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

- Implemented by GLM-5.3 sub-agent (Paseo) in worktree `fix-scan-skip-hidden-dirs`. Tests written first: trash, internal and case-insensitive tests failed on unpatched main (3 failed, 3 passed).
- `_next_dir` checks the name before `is_dir()`; a hidden *file* returns None there and still goes through `_candidate`, so file-level behaviour is unchanged.
- `IGNORED_DIR_NAMES` (frozenset) moved to `fs_walker.py`; `watcher.py` keeps `IGNORED_DIRS` as an alias. `fs_walker` has no watchdog import, so no new dependency for the watcher.
- Plan's Black command was not achievable: Black is neither in requirements-dev nor in `scripts/run_quality_gate.py`, and it flags pre-existing upstream lines only. Ruff (the gate's formatter/linter) is clean.
- Host-only pytest failure `test_custom_roots_routes.py::test_browse_folder_headless_and_success_and_cancel` is environmental (fails identically on baseline on this desktop host; passes in the container gate).

## Plan Change Log

## Review Triage Log

### 2026-11-04 — Review pass
- verdicts: 2 findings — high 0, medium 0, low 1, false 0, maybe-false 0, rejected-plan-edit 1
- findings:
  - `[low]` `[patch]` Windows `$RECYCLE.BIN` (send2trash's Windows target) is neither dot-prefixed nor in the set, so a scan rooted at a drive root still walks it — added `$recycle.bin` and `system volume information` to `IGNORED_DIR_NAMES`, test with `$RECYCLE.BIN/S-1-5-21/$Rabc.png`, CHANGELOG widened (amended into bc2dd28a).
  - `[low]` `[reject]` Plan's `black --check` verification can never pass — fix would edit the plan; Black is not part of the repo's gate and only pre-existing lines are flagged. Recorded in Implementation Notes.

## Verification

All commands run in the worktree on Python 3.12 (`uv venv -p 3.12 .venv && uv pip install -r requirements-dev.txt`):

**Commands:**
- `.venv/bin/python -m pytest tests/features/test_index_fs_walker.py tests/features/test_index_fs_walker_more.py -q` -- expected: all pass
- `.venv/bin/python -m pytest tests -q -x -p no:cacheprovider` -- expected: no new failures vs baseline
- `.venv/bin/python -m ruff check mjr_am_backend tests && .venv/bin/python -m black --check -l 100 mjr_am_backend/features/index tests/features/test_index_fs_walker.py` -- expected: clean
- Full gate (`npm run quality`) is run by the orchestrator in the node:24-bookworm container.

## Auto Run Result

- **Summary:** the recursive scan walker skips subdirectories that are hidden (dot-prefixed) or Majoor/OS-internal (`_mjr_index`, `.git`, `__pycache__`, `node_modules`, `$RECYCLE.BIN`, ...), sharing one name list with the watcher. Scan roots under dot-paths still scan.
- **Branch:** `fix/scan-skip-hidden-dirs` @ `bc2dd28a` (single commit off upstream/main 599b47df), worktree `../fix-scan-skip-hidden-dirs`. Not pushed.
- **Files:** `mjr_am_backend/features/index/fs_walker.py` (shared set + name check in `_next_dir`); `mjr_am_backend/features/index/watcher.py` (alias the shared set); `tests/features/test_index_fs_walker.py` (7 tests); `CHANGELOG.md` (Unreleased → Fixed).
- **Review:** 1 patch applied (low), 0 deferred, 1 rejected (plan-edit). Follow-up review recommended: false (no high, fewer than two medium patched).
- **Verification:** full gate in `node:24-bookworm` (Python 3.11): pytest 1938 passed / 2 skipped (torch), Vitest 858 passed, Ruff/Mypy/Bandit/Xenon/ESLint/npm audit clean. Known-red-on-main checks: pip-audit (Pillow 12.x CVEs, pinned <13) and repo-wide Prettier (237 files; no UI files changed here). Issue reproducer prints `['live.png']` on the branch vs `['deleted.png', 'internal.png', 'live.png']` on main.
- **Residual risk:** users who keep assets in a dot-prefixed subfolder of a root lose them from recursive scans (consistent with the folder browser, which already hides dot-folders). Called out in the PR draft.
- **Upstream gate:** issue draft `drafts/1.1-issue.md`, PR draft `drafts/1.1-pr.md` — both held for operator approval.

### PR opened 2026-11-04

Operator approved; opened upstream as #274. Ticket stays `built` until merged or closed upstream.

### 2026-11-04 — Integrated with upstream/main 39defc34
Upstream moved 30 commits after the 599b47df baseline. Merged `upstream/main` into the branch (merge commit, no rebase/force-push), resolved committed `dist/` by taking upstream's and rebuilding in the container (separate `chore(dist): rebuild`), and re-ran the full gate. Two upstream floating-viewer Vitest cases time out only when several gates run in parallel (pass alone and on main). The gate now clears `tests/__pytest_tmp__` first (upstream's new BOM fixtures there tripped the BOM check on re-runs).
Conflict in `watcher.py` (upstream added `sidecar_media_paths` next to `IGNORED_DIRS`): kept upstream's function and our shared-set alias. Pushed to the fork as a fast-forward, updating open PR #274. Gate after merge: pytest 1967 passed, Vitest 862 passed.

### 2026-11-05 — Merged upstream
PR #274 merged by the maintainer on 2026-11-05 (no review comments); linked issue closed. Ticket marked `done`. Homelab follow-up: drop the matching vendored patch when re-vendoring a Majoor release that contains this change.
