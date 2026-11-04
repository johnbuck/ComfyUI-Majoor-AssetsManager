---
title: 'Bulk star rating across a selection (batch route, hotkeys, menu)'
type: 'feature'
ticket: '4'
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
branch: 'feat/bulk-rating'
worktree: '/home/trumble/.paseo/worktrees/1ldb4s2k/feat-bulk-rating'
---

<intent-contract>

## Intent

**Problem:** On upstream/main (599b47df) the 0–5 rating hotkeys walk the selection
(`ui/features/panel/controllers/ratingHotkeysController.ts:79-98,180`) but send one
`POST /mjr/am/asset/rating` per card at concurrency 5, against a 30/min route limit, so large selections
fail partway; the grid menu's "Set rating" submenu (`GridContextMenu.ts:939-1002, 1598-1602`) rates only
the right-clicked card even when several are selected.

**Approach:** A batch route `POST /mjr/am/assets/rating {ids, rating}`; the hotkeys and the "Set rating"
submenu use it in chunks whenever more than one card is selected.

## Boundaries & Constraints

**Always:**
- Route reuses `prepare_asset_ids_context` with operation `assets_rating`, rate limit 10 req / 60 s, `ids`
  capped at 500 (`INVALID_INPUT` above); rating parsed with the existing `parse_rating_value` (0–5).
- Per asset, the existing `update_asset_rating` (its per-asset lock + Comfy-core write-through) — no
  single transaction across assets. Missing ids → `failed` with `NOT_FOUND`, others processed (partial).
- `enqueue_rating_tags_sync` per updated id (honours `X-MJR-RTSYNC`). One audit entry per request
  (`assets_rating`, target truncated to 25 ids, details rating + counts).
- Response data: `{updated_ids: [int], failed: [{id, code, error}], rating: int}`.
- UI hotkeys: with ≥2 selected ids, chunked batch calls (≤500, sequential) instead of the per-id runner;
  dispatch the existing `mjr:asset-rating-changed` `{assetId, rating}` for each updated id (badges update as
  today); one summary toast (success, or "N rated, M failed"); progress toast when >1 chunk. With one
  selected card the existing path is unchanged.
- "Set rating" submenu with ≥2 selected cards: parent label `Set rating (N selected)`, choosing a value
  rates the whole selection through the same batch helper. Single-card submenu unchanged.
- Tests for every matrix row; docs: `docs/API_REFERENCE.md` (beside "Update Rating"),
  `docs/RATINGS_TAGS_COLLECTIONS.md`, `routes/handlers/asset_docs.py`, `CHANGELOG.md`. Final separate
  `chore(dist): rebuild` commit.

**Never:** No change to the single rating route, the viewer, `GridKeyboard.ts`'s legacy single-asset
path, or `ratingUpdater.ts` debounce for single cards. No server broadcast. No filepath-keyed batch input.
No reformatting of pre-existing lines. Never run node/npm on the host.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Rate all | ids [1,2,3], rating 4 | updated_ids [1,2,3]; each asset rating 4 | none |
| Clamp | rating 9 | parsed per `parse_rating_value` (5) | none |
| Missing id | ids [1,999] | 1 updated; failed [{999, NOT_FOUND}] | partial |
| Bad body | ids empty / >500 / non-int; rating missing | `ok:false INVALID_INPUT` | no writes |
| Rate limit | 11th request in 60 s | `RATE_LIMITED` | no writes |
| Sync | `X-MJR-RTSYNC: on`, 2 updated | sync enqueued for those 2 only | none |
| Hotkey multi | 3 selected, press 4 | one batch call {ids:3, rating:4}; 3 rating-changed events; no single calls | summary toast |
| Hotkey chunking | 1201 selected | 3 sequential calls (500,500,201); progress toast | failed counted |
| Hotkey partial | batch returns failed [2] | events only for updated ids; toast "2 rated, 1 failed" | warning toast |
| Hotkey single | 1 selected | existing per-asset path (unchanged) | as today |
| Menu multi | 3 selected, "Set rating (3 selected)" → 2 | one batch call rating 2 | toast |
| Menu single | 1 selected | existing submenu behaviour | as today |

</intent-contract>

## Code Map

- `mjr_am_backend/routes/handlers/assets_impl.py:247-266` -- single rating route; register
  `POST /mjr/am/assets/rating` with the same wiring; `_audit_asset_write` :98-116; `_wired_enqueue_rating_tags_sync` :185-197.
- `mjr_am_backend/features/assets/request_context_service.py:357-401` -- `prepare_asset_ids_context`.
- New `mjr_am_backend/routes/assets/route_actions_batch_rating.py` -- handler (pattern:
  `route_actions_batch_delete.py`: audit target truncation :15-16, partial result shape :227-260).
- `mjr_am_backend/features/assets/rating_tags_service.py:135-141` `parse_rating_value`; :84-109 `enqueue_rating_tags_sync`.
- `mjr_am_backend/features/index/updater.py:35-74` -- `update_asset_rating` (lock + UPSERT + core sync); call
  per id via the index facade `features/index/service.py:561-585`. Check existence in one `aquery_in`
  (chunk ≤900; `sqlite_facade.py:777-804` does not chunk).
- `mjr_am_backend/routes/handlers/asset_docs.py:75-76` -- route catalogue.
- Tests: `tests/features/test_assets_impl_routes.py` (bulk-delete tests :540-938 as template; fake `_Index`).
- UI: `ui/api/client.ts:231-255` (`updateAssetRating`, `X-MJR-RTSYNC` :200-210) -- add
  `updateAssetsRatingBulk(ids, rating)`; `ui/api/endpoints.ts`.
- `ui/features/panel/controllers/ratingHotkeysController.ts` -- selection `getSelectedIdSet` :22-43, runner
  :79-98, per-asset apply/toast/event :105-129, keydown :136-181, badge listener :183-190.
- `ui/features/contextmenu/GridContextMenu.ts:939-1002` `_buildRatingSubmenu`, `:1598-1602` item,
  `:496-535` `setRating`, selection snapshot :881-892.
- UI tests: `ui/tests/rating_hotkeys.vitest.ts` (extend), new `ui/tests/bulk_rating.vitest.ts`.

## Tasks & Acceptance

**Execution:**
- [ ] `route_actions_batch_rating.py` + registration + `asset_docs.py`.
- [ ] pytest per backend matrix row.
- [ ] client `updateAssetsRatingBulk` + a small chunked helper (e.g. `ui/features/grid/bulkRating.ts`).
- [ ] hotkeys controller + "Set rating" submenu wiring.
- [ ] Vitest per UI matrix row.
- [ ] docs + CHANGELOG; final `chore(dist): rebuild`.

**Acceptance Criteria:**
- Given 200 selected cards, when the user presses 4, then all 200 are rated 4 with at most one request per 500 cards and every card badge updates.
- Given the new tests, when run on unmodified main, then they fail.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Verification

Python: `uv venv -p 3.12 .venv && uv pip install --python .venv/bin/python -r requirements-dev.txt`. Node ONLY via `sh /tmp/majoor-gate/node.sh <worktree> <cmd...>`.

**Commands:**
- `.venv/bin/python -m pytest tests/features/test_assets_impl_routes.py -q` -- expected: pass
- `.venv/bin/python -m ruff check <changed py files>`; `.venv/bin/python -m mypy --config-file mypy.ini` -- clean
- `sh /tmp/majoor-gate/node.sh $PWD npx vitest run` -- all pass
- Prettier drift on edited UI files ≤ upstream/main; new files clean
- `sh /tmp/majoor-gate/node.sh $PWD npm run build` -- succeeds
