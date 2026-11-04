---
title: 'Multi-card delete goes through the bulk assets/delete endpoint'
type: 'bugfix'
ticket: '2'
created: '2026-11-04'
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
  deleted_ids, failed_ids}, meta:{partial:true}}`; rejection `{ok:false, code, error}`.
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

## Plan Change Log

## Review Triage Log

## Verification

Node runs ONLY in the container: `sh /tmp/majoor-gate/node.sh <worktree> <cmd...>`.

**Commands:**
- `sh /tmp/majoor-gate/node.sh $PWD npx vitest run ui/tests/bulk_delete.vitest.ts` -- expected: pass
- `sh /tmp/majoor-gate/node.sh $PWD npx vitest run` -- expected: all pass
- `sh /tmp/majoor-gate/node.sh $PWD npx eslint <changed ui files>` and `... npx prettier --check <changed ui files>` -- expected: clean
- `sh /tmp/majoor-gate/node.sh $PWD npm run build` -- expected: succeeds; commit `dist/` separately
- Full gate (`/tmp/majoor-gate/gate.sh`) is run by the orchestrator.
