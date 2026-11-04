---
title: 'Multi-card delete goes through the bulk assets/delete endpoint'
type: 'bugfix'
ticket: '2'
created: '2026-11-04'
status: 'built'
route: 'full'
route_source: 'pinned'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 1
followup_review_recommended: false
context: []
baseline_revision: '599b47dfc1657b28d73ddf62076942e02776e55c'
warnings: []
deferred: []
branch: 'fix/bulk-delete-endpoint'
worktree: '/home/trumble/.paseo/worktrees/1ldb4s2k/fix-bulk-delete-endpoint'
---

<intent-contract>

## Intent

**Problem:** On upstream/main (verified 2026-11-04 at 599b47df) the grid menu's "Delete N files…"
(`ui/features/contextmenu/GridContextMenu.ts` ~1716–1787) and the Delete/Backspace key on a selection
(`ui/features/grid/GridKeyboard.ts` ~801–878) loop `deleteAsset()` per card: one
`POST /mjr/am/asset/delete` each, capped at 20/min, so large selections fail partway. The bulk endpoint
`POST /mjr/am/assets/delete` (`{"ids": [...]}`, 10 req/min, send2trash, partial results) exists with a
client wrapper `deleteAssets(ids)` (`ui/api/clientOps.ts:393`), used only by duplicates cleanup.

**Approach:** One shared helper deletes a selection through the bulk endpoint in chunks, with a
graceful fallback, and both multi-card paths use it. Fix `deleteAssets` to report only ids actually
deleted. Fix the API doc's request-body key.

## Boundaries & Constraints

**Always:** Keep each path's existing confirmation behaviour exactly (menu: `confirmDeletion(count)`;
keyboard: unchanged), existing toasts/i18n keys, card removal and selection-update logic. Assets
without an `id` (filepath-only browser cards) keep using single `deleteAsset(asset)` on the menu path
(keyboard path already skips them). Vue/TS house style, ESLint + Prettier clean on changed files.
Rebuild `dist/` in a separate final commit (`chore(dist): rebuild`).

**Never:** No backend changes. No change to single-card delete, the viewer menu, or the duplicates
flow's behaviour beyond the `deleteAssets` event fix. No new settings. Never run npm/node on the host.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Small selection | 3 cards with ids | one `deleteAssets` call with 3 ids; no single deletes | none |
| Large selection | 1201 cards with ids | 3 bulk calls (500, 500, 201), sequential; progress toast shown | none |
| Partial result | bulk returns ok with `deleted_ids`=[1,2], `failed_ids`=[3] | cards 1,2 removed; 3 stays; partial toast "2 deleted, 1 failed" | none |
| Whole-chunk rejection | bulk returns `ok:false` (e.g. NOT_FOUND for a stale id; validation is all-or-nothing, nothing deleted) | that chunk falls back to per-id `deleteAsset`, counted per result | per-id failures counted as failed |
| Mixed id / filepath-only (menu) | 2 with id, 1 without | 1 bulk call (2 ids) + 1 single `deleteAsset(asset)`; grid reload for the filepath one as today | none |
| Network/exception on a chunk | `deleteAssets` throws | chunk counted failed, remaining chunks still attempted | error swallowed into counts |
| `deleteAssets` event | partial result | `mjr:assets-deleted` detail.ids = server `deleted_ids` only | none |

</intent-contract>

## Code Map

- `ui/api/clientOps.ts:376–414` -- `deleteAsset`, `deleteAssets`, `_emitAssetsDeleted`. Change
  `deleteAssets` to emit `res.data.deleted_ids` (fall back to requested ids only when the response has no
  `deleted_ids` and is not partial).
- New `ui/features/grid/bulkDelete.ts` (or beside existing delete utils; follow folder conventions) --
  `deleteAssetsInChunks(assets, {chunkSize = 500, onProgress})` → `{deletedIds: string[],
  failedCount: number, deletedByFilepath: number}`. Sequential chunks; fallback per matrix.
  Response shape: success `{ok, data:{deleted, deleted_ids}}`; partial `{ok:true, data:{deleted,
  deleted_ids, failed_ids}, meta:{partial:true,...}}` — detect partial by a non-empty `data.failed_ids`
  (do not depend on `meta`); rejection `{ok:false, code, error}`.
- `ui/features/contextmenu/GridContextMenu.ts:1716–1787` -- replace the per-card loop with the helper;
  keep `removeAssetsFromGrid`, `triggerBrowserGridReload`, toasts.
- `ui/features/grid/GridKeyboard.ts:801–878` -- replace the per-card loop with the helper; keep
  `_mjrRemoveAssets`, toasts, selection update.
- Progress toast: use existing `comfyToast` with an existing-style i18n key; add new keys to
  `ui/app/i18n.ts` (and locales/ if keys are mirrored there — check how other keys are added).
- `docs/API_REFERENCE.md:~599–616` -- bulk delete request body `asset_ids` → `ids`; response example
  to match the real `deleted`/`deleted_ids`/`failed_ids` keys.
- Tests: `ui/tests/*.vitest.ts` (vitest include `ui/tests/**/*.vitest.ts`); see
  `ui/tests/grid_context_menu_tones.vitest.ts`, `ui/tests/grid_keyboard_navigation.vitest.ts`,
  `ui/tests/client_ops_open_in_folder.vitest.ts` for mocking patterns.
- `CHANGELOG.md` -- Unreleased → Fixed.

## Tasks & Acceptance

**Execution:**
- [ ] `ui/api/clientOps.ts` -- `deleteAssets` emits only deleted ids.
- [ ] new helper file -- chunked bulk delete with fallback and progress callback.
- [ ] `GridContextMenu.ts`, `GridKeyboard.ts` -- use the helper.
- [ ] `ui/app/i18n.ts` (+ locales if needed) -- progress toast key.
- [ ] `ui/tests/bulk_delete.vitest.ts` (new) -- one test per matrix row (mock `deleteAssets`/`deleteAsset`).
- [ ] `docs/API_REFERENCE.md`, `CHANGELOG.md`.
- [ ] Final separate commit: `npm run build` (via container wrapper) and commit `dist/`.

**Acceptance Criteria:**
- Given 100 selected cards with ids, when the user deletes via menu or Delete key, then exactly one bulk request is sent and no single-delete requests.
- Given the new tests, when run against unmodified main, then they fail (helper missing / per-card calls observed).

## Implementation Notes

- Built by GLM-5.3 sub-agent (Paseo) in worktree `fix-bulk-delete-endpoint`; tests first (suite failed to resolve `bulkDelete.js` on main).
- Bulk route semantics verified on main: validation is all-or-nothing before any file is touched (NOT_FOUND for a missing id, FORBIDDEN/INVALID_INPUT for a bad path); partial results carry `deleted_ids` + `failed_ids`; the fetch client forwards the full envelope including `meta`, and retries HTTP 429 itself.
- `deleteAssets()` previously emitted `mjr:assets-deleted` for every requested id even on partial failure; now only `deleted_ids` (no in-repo listeners, so no behaviour change elsewhere).
- Additive backend change (plan amendment): rejections carry `meta.missing_ids` / `meta.rejected_ids` (all offending ids); `_result_err` forwards meta (single caller).
- Gate note: Python coverage on main oscillates 67.97–68.02% around the 68% floor; the upstream gate script does not fail on it. Pre-existing.
- Side finding (not in scope): the Delete key deletes a selection with no confirmation dialog on main (menu path confirms). Candidate follow-up issue.

## Plan Change Log

### 2026-11-04 — amendments from review
- **Trigger 1 (orchestrator review):** whole-chunk `RATE_LIMITED` from the bulk route fell back to up to 500 single deletes (20/min cap). **Amended:** a `RATE_LIMITED` chunk is counted failed, no fallback. **Also:** on an ok response, failures = `ids.length - deleted_ids.length`.
- **Trigger 2 (quick lens):** bulk validation is all-or-nothing, so one stale or out-of-root id in a 500-id chunk sent the chunk to the per-id fallback, where everything past the single-delete cap failed. **Amended (lifts the "No backend changes" Never for one additive change):** `route_actions_batch_delete.py` attaches the offending ids to the rejection's `meta` (`missing_ids` for NOT_FOUND, `rejected_ids` for path FORBIDDEN/INVALID_INPUT), and the UI drops those ids (counted failed) and retries the rest of the chunk once through the bulk route. The per-id fallback is only used when the rejection names no ids. Known-bad state avoided: a 500-card delete reporting ~480 failures because of one stale card.
- **KEEP:** chunk size 500, sequential chunks, filepath-only singles, `deleteAssets` emitting only `deleted_ids`, menu/keyboard confirmation behaviour, progress toast only when `done < total`, separate dist commit.

## Review Triage Log

### 2026-11-04 — Review pass 1 (orchestrator + quick lens)
- verdicts: 5 findings — high 0, medium 2, low 2, false 0, maybe-false 0, rejected 1
- findings:
  - `[medium]` `[bad_plan]` (orchestrator) RATE_LIMITED chunk fell back to ≤500 single deletes (20/min) — plan amended; chunk counted failed.
  - `[low]` `[patch]` (orchestrator) ids missing from both `deleted_ids` and `failed_ids` were not counted — failures = ids − deleted_ids.
  - `[low]` `[reject]` (lens) RATE_LIMITED special case deviates from plan matrix — it is the orchestrator's amendment, now in the Plan Change Log.
  - `[low]` `[patch]` (lens) CHANGELOG text did not match fallback behaviour — rewritten.
  - `[medium]` `[bad_plan]` (lens) one stale/out-of-root id sent a 500-id chunk to per-id fallback (~480 rate-limited failures) — plan amended (lift "no backend changes" for additive meta); UI drops named ids and retries in bulk.
- Prettier: first build added drift (226 vs 222) in GridContextMenu.ts — reformatted only the changed hunk.

### 2026-11-04 — Review pass 2 (follow-up lens)
- verdicts: 3 findings — high 0, medium 1, low 2, false 0, maybe-false 0
- findings:
  - `[low]` `[patch]` ok response without `deleted_ids` but with `failed_ids` dropped the non-failed ids from both counts — treated as deleted; test added.
  - `[medium]` `[patch]` backend named only the first bad row and the UI retry ignored the retry's named ids, so ≥2 bad ids per chunk still hit the per-id fallback — backend aggregates all failing rows into `rejected_ids`; UI loops up to 3 bulk attempts dropping named ids; tests (backend 2-row, UI NOT_FOUND→FORBIDDEN→ok).
  - `[low]` `[patch]` CHANGELOG claimed fallback only when nothing named — rewritten to match the bounded loop.

## Verification

Node runs ONLY in the container: `sh /tmp/majoor-gate/node.sh <worktree> <cmd...>`.

**Commands:**
- `sh /tmp/majoor-gate/node.sh $PWD npx vitest run ui/tests/bulk_delete.vitest.ts` -- expected: pass
- `sh /tmp/majoor-gate/node.sh $PWD npx vitest run` -- expected: all pass
- `sh /tmp/majoor-gate/node.sh $PWD npx eslint <changed ui files>` and `... npx prettier --check <changed ui files>` -- expected: clean
- `sh /tmp/majoor-gate/node.sh $PWD npm run build` -- expected: succeeds; commit `dist/` separately
- Full gate (`/tmp/majoor-gate/gate.sh`) is run by the orchestrator.

## Auto Run Result

- **Summary:** "Delete N files…" and the Delete key on a selection go through `POST /mjr/am/assets/delete` in sequential 500-id chunks instead of one single-delete request per card. Rejected chunks drop the server-named offending ids and retry in bulk (≤3 attempts), per-id fallback only when nothing is named; rate-limited chunks are reported failed. Filepath-only cards keep single deletes. `deleteAssets()` emits only actually-deleted ids. Bulk-route rejections gain additive `meta.missing_ids` / `meta.rejected_ids`. API doc request body corrected (`ids`).
- **Branch:** `fix/bulk-delete-endpoint` @ f171c25d (fix 0f23422d, docs ae36ff59, chore(dist) f171c25d) off upstream/main 599b47df. Nothing posted upstream.
- **Files:** `ui/features/grid/bulkDelete.ts` (new); `ui/features/contextmenu/GridContextMenu.ts`, `ui/features/grid/GridKeyboard.ts` (use helper); `ui/api/clientOps.ts` (event fix); `ui/app/i18n.ts` (progress key); `mjr_am_backend/routes/assets/route_actions_batch_delete.py` (additive meta, aggregate rejected ids); tests `ui/tests/bulk_delete.vitest.ts` (15), `tests/features/test_assets_impl_routes.py` (+3); `docs/API_REFERENCE.md`; `CHANGELOG.md`; `dist/`.
- **Review:** 2 passes; 6 patches (2 medium, 4 low incl. Prettier), 2 plan amendments, 1 rejected, 0 deferred. Follow-up review recommended: false (pass 2 is a follow-up pass with no high).
- **Verification:** full gate in `node:24-bookworm`: pytest 1934 passed; Vitest 873 passed; Ruff/Mypy/Bandit/Xenon/ESLint/npm audit clean; Prettier drift on edited files equal to main, new files clean.
- **Residual risk:** a 5000+-card delete exceeds the bulk route's 10/min limit; the fetch client's own 429 retry may absorb it, otherwise later chunks are reported failed (visible in the toast). Delete-key path still has no confirmation (pre-existing).

### 2026-11-04 — Integrated with upstream/main 39defc34
Upstream moved 30 commits after the 599b47df baseline. Merged `upstream/main` into the branch (merge commit, no rebase/force-push), resolved committed `dist/` by taking upstream's and rebuilding in the container (separate `chore(dist): rebuild`), and re-ran the full gate. Two upstream floating-viewer Vitest cases time out only when several gates run in parallel (pass alone and on main). The gate now clears `tests/__pytest_tmp__` first (upstream's new BOM fixtures there tripped the BOM check on re-runs).
Source merged clean; dist rebuilt. Gate after merge: pytest 1963, Vitest 877.
