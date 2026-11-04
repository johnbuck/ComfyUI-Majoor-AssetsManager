---
title: 'Bulk tag add/remove across a selection (batch route + bulk editor)'
type: 'feature'
ticket: '3'
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
warnings: ['oversized']
deferred: []
branch: 'feat/bulk-tags'
worktree: '/home/trumble/.paseo/worktrees/1ldb4s2k/feat-bulk-tags'
---

<intent-contract>

## Intent

**Problem:** Majoor (upstream/main 599b47df) can only edit one asset's tags at a time ("Edit tags" in the
grid menu acts on the right-clicked card). There is no multi-asset tag route; the only per-asset path is
`POST /mjr/am/asset/tags` (replace semantics, 30/min).

**Approach:** A batch route `POST /mjr/am/assets/tags {ids, add, remove}` that merges per asset on the
server — `(existing ∪ add) − remove` — and a bulk editor opened from "Edit tags" when several cards are
selected, showing each tag's coverage and applying add/remove to the whole selection in chunked batch
calls.

## Boundaries & Constraints

**Always:**
- Route reuses `prepare_asset_ids_context` (CSRF, write access, operation enabled) with operation
  `assets_tags` and its own rate limit (10 req / 60 s). `ids` capped at 500 per request (`INVALID_INPUT`
  above). `add`/`remove` are lists sanitised with the existing `sanitize_tags` (control chars, trim,
  length ≤ 100, case-insensitive dedupe); at least one non-empty after sanitising.
- Per asset, inside the existing per-asset lock: read current tags, compute `(existing ∪ add) − remove`
  case-insensitively (keep existing casing; tags added take the request's casing), and write with the
  existing replace path only if the set changed. If the merged set would exceed 50 tags that asset fails
  (`"Too many tags (max 50)"`) and is left untouched. No single transaction spans many assets.
- Ids not found → listed in `failed` with code `NOT_FOUND`; other ids still processed (partial result,
  `Result.Ok(..., partial=True)` when anything failed).
- For each changed asset call `enqueue_rating_tags_sync` (honours `X-MJR-RTSYNC` like the single route).
- One audit entry per request (`assets_tags`, target truncated to 25 ids like batch delete, details:
  add/remove counts, updated/failed counts).
- Response data: `{updated_ids: [int], unchanged_ids: [int], failed: [{id, code, error}], tags: {"<id>": [final tags]}}`
  (`tags` covers updated and unchanged ids).
- UI: "Edit tags" with ≥2 selected cards → label `Edit tags (N selected)` → bulk editor. Single-card
  behaviour unchanged. Workflow-kind assets (`kind === "workflow"`) are excluded from the bulk call and
  reported as skipped in the result toast (they use a different tags endpoint).
- Bulk editor shows the union of the selection's current tags with coverage `tag (k/N)` (hydrate current
  tags via the existing `getAssetsBatch` client, since virtualised cards may be stale); typing a tag + Enter
  adds it to all; ✕ on a tag removes it from all; clicking a partial tag (k<N) adds it to the rest. Each
  action sends chunked batch calls (≤500 ids, sequential), progress toast when >1 chunk, updates coverage
  from the response `tags`, and dispatches the existing `mjr:asset-tags-changed` `{assetId, tags}` per
  updated asset so card badges/sidebar/viewer refresh. Editor caps a tag list at 50 like the server.
- Tests for every matrix row; docs: `docs/API_REFERENCE.md` (new section beside "Update Tags"),
  `docs/RATINGS_TAGS_COLLECTIONS.md` (bulk tagging), `routes/handlers/asset_docs.py` route catalogue,
  `CHANGELOG.md`. Rebuild `dist/` in a final separate commit.

**Never:** No change to the single-asset tags route/semantics, the T key, the viewer, or
`TagsEditor.vue`'s single-asset behaviour. No server broadcast (singles have none). No filepath-keyed
batch input. No reformatting of pre-existing lines (Prettier drift on edited files must not grow). Never
run node/npm on the host.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Add to all | ids [1,2]; 1 has [a], 2 has [] ; add [b] | 1 → [a,b], 2 → [b]; both updated | none |
| Remove from all | 1 [a,b], 2 [b]; remove [b] | 1 → [a], 2 → []; updated | none |
| Add+remove | 1 [a,b]; add [c], remove [a] | [b,c] | none |
| Case-insensitive | 1 [Cat]; add [cat] | unchanged_ids [1], no write | none |
| Unchanged | 1 [a]; remove [z] | unchanged_ids [1] | none |
| Too many | 1 has 50 tags; add [new] | failed [{1, INVALID_INPUT, "Too many tags (max 50)"}], others proceed | partial |
| Missing id | ids [1,999] | 1 updated; failed [{999, NOT_FOUND}] | partial |
| Bad body | add/remove both empty after sanitise, ids empty, ids >500, non-list | `ok:false INVALID_INPUT` | no writes |
| Rate limit | 11th request in 60 s | `RATE_LIMITED` | no writes |
| Sync enqueue | `X-MJR-RTSYNC: on`, 2 updated | `enqueue_rating_tags_sync` called for the 2 updated ids only | none |
| UI multi-select | 3 selected, "Edit tags (3 selected)" → add "x" | one batch call {ids:3, add:[x]}; 3 tag-changed events | toast on failure |
| UI chunking | 1201 selected, add | 3 sequential calls (500,500,201); progress toast | failed ids counted |
| UI workflow skip | selection has 1 workflow asset | excluded from call; toast notes 1 skipped | none |

</intent-contract>

## Code Map

- `mjr_am_backend/routes/handlers/assets_impl.py:247-290, 395-421` -- single tags route and batch delete
  registration; register `POST /mjr/am/assets/tags` here (same wiring style). `MAX_TAGS_PER_ASSET`/
  `MAX_TAG_LENGTH` at :89-90; `_audit_asset_write` :98-116; `_wired_sanitize_tags` / `_wired_enqueue_rating_tags_sync` :185-197.
- `mjr_am_backend/features/assets/request_context_service.py:357-401` -- `prepare_asset_ids_context`
  (reads `body["ids"]`, int-coerces, no cap — add the 500 cap in the handler).
- New `mjr_am_backend/routes/assets/route_actions_batch_tags.py` -- handler (pattern:
  `route_actions_batch_delete.py`, audit target truncation :15-16, partial result :227-260).
- `mjr_am_backend/features/assets/rating_tags_service.py:144-169` -- `sanitize_tags`; :84-109 `enqueue_rating_tags_sync`.
- `mjr_am_backend/features/index/updater.py:76-133` -- `update_asset_tags` / `_write_asset_tags`
  (lock_for_asset + replace_all). Add a merge method here (e.g. `merge_asset_tags(asset_id, add, remove)`
  returning `Result[{"changed": bool, "tags": [...]}]`), reading current tags inside the lock
  (`asset_tags JOIN tags`, see `features/duplicates/service.py:514-546`). Expose via the index facade
  `features/index/service.py:561-585`.
- `mjr_am_backend/routes/handlers/asset_docs.py:75-76` -- route catalogue entry.
- Tests: `tests/features/test_assets_impl_routes.py` (bulk-delete tests :540-938 are the template; fakes
  `_Index`, `_DummyDB`), `tests/features/test_asset_updater.py` for the merge method.
- UI: `ui/api/client.ts:260-293` (`updateAssetTags`, `X-MJR-RTSYNC` header logic :200-210),
  `getAssetsBatch` :340-350 -- add `updateAssetsTagsBulk(ids, {add, remove})`; `ui/api/endpoints.ts`.
- `ui/features/contextmenu/GridContextMenu.ts:1584-1596` ("Edit tags"), `:1831-1839` `showTagsPopover`,
  selection snapshot `_getSelectionSnapshot` :881-892 and `getSelectedAssets` :147-191.
- `ui/features/contextmenu/gridContextMenuState.ts:101-116` (`openGridTagsPopover`) and
  `ui/vue/components/grid/GridContextMenu.vue:337-346` (renders `TagsEditor`) -- add a bulk mode/state and
  a new `ui/vue/components/grid/BulkTagsEditor.vue` (Vue 3 Composition API).
- Events `ui/app/events.ts:1-2`; i18n `ui/app/i18n.ts`.
- UI tests: `ui/tests/*.vitest.ts` (patterns: `rating_tags_id_save.vitest.ts`, `bulk`-style mocks).

## Tasks & Acceptance

**Execution:**
- [ ] updater merge method + facade -- server-side merge under per-asset lock.
- [ ] `route_actions_batch_tags.py` + registration in `assets_impl.py` + `asset_docs.py`.
- [ ] pytest: one test per backend matrix row.
- [ ] client `updateAssetsTagsBulk` + endpoint; `BulkTagsEditor.vue`; state/menu wiring.
- [ ] Vitest: UI matrix rows + editor coverage display.
- [ ] docs + CHANGELOG; final `chore(dist): rebuild`.

**Acceptance Criteria:**
- Given 100 selected cards with differing tags, when the user adds "x" and removes "y" in the bulk editor, then every card has "x", none has "y", and every other tag is unchanged.
- Given the new tests, when run on unmodified main, then they fail.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Verification

Python: `uv venv -p 3.12 .venv && uv pip install --python .venv/bin/python -r requirements-dev.txt`. Node ONLY via `sh /tmp/majoor-gate/node.sh <worktree> <cmd...>`.

**Commands:**
- `.venv/bin/python -m pytest tests/features/test_assets_impl_routes.py tests/features/test_asset_updater.py -q` -- expected: pass
- `.venv/bin/python -m ruff check <changed py files>` and `.venv/bin/python -m mypy --config-file mypy.ini` -- expected: clean
- `sh /tmp/majoor-gate/node.sh $PWD npx vitest run` -- expected: all pass
- Prettier drift check on edited UI files (≤ upstream/main), new files clean
- `sh /tmp/majoor-gate/node.sh $PWD npm run build` -- succeeds
