---
title: 'Env knobs for the single-delete and asset-write (rating/tags) rate limits'
type: 'feature'
ticket: '3'
created: '2026-11-03'
status: 'in-review'
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
branch: 'feat/configurable-write-rate-limits'
worktree: '/home/trumble/.paseo/worktrees/1ldb4s2k/feat-configurable-write-rate-limits'
---

<intent-contract>

## Intent

**Problem:** On upstream/main (verified 2026-11-03 at 599b47df) the single-asset delete route is capped at
a hard-coded 20 requests/min (`route_actions_delete.py:59`) and rating/tag writes at 30/min
(`assets_impl.py:143`, `_prepare_asset_op_request`, shared by `asset_rating` and `asset_tags`). The UI's
multi-card delete and rating hotkeys send one request per card, so a selection larger than the cap fails
partway with RATE_LIMITED, and an operator has no way to raise the cap short of patching the code.

**Approach:** Two env knobs in `mjr_am_backend/config.py`, read with the existing `_env_int` helper:
`MJR_AM_DELETE_RATE_LIMIT` (default 20) and `MJR_AM_ASSET_WRITE_RATE_LIMIT` (default 30), each clamped to
1..10000 requests per 60 s window. The two routes use them instead of the literals. Defaults are unchanged.

## Boundaries & Constraints

**Always:** Defaults stay exactly 20 and 30; window stays 60 s. Invalid values fall back to the default
and out-of-range values clamp (that is `_env_int`'s existing behaviour, with its warning log). Document
both knobs. Black 100, Ruff, MyPy clean.

**Never:** Do not touch other routes' limits (rename stays 20, batch delete stays 10), the rate limiter
itself, or the UI. No settings-panel UI for these. No homelab references in code, comments, tests, docs, or
commit text.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Unset | neither env var set | delete limit 20, asset-write limit 30 | none |
| Set valid | `MJR_AM_DELETE_RATE_LIMIT=600`, `MJR_AM_ASSET_WRITE_RATE_LIMIT=600` | both resolve to 600 | none |
| Non-integer | `MJR_AM_DELETE_RATE_LIMIT=abc` | 20 | warning logged by `_env_int` |
| Below range | `MJR_AM_ASSET_WRITE_RATE_LIMIT=0` | clamped to 1 | warning logged |
| Above range | `MJR_AM_DELETE_RATE_LIMIT=999999` | clamped to 10000 | warning logged |
| Delete route uses knob | knob = N | `prepare_asset_route_context` for `asset_delete` receives `max_requests=N` | none |
| Rating/tags route uses knob | knob = N | `_prepare_asset_op_request` passes `max_requests=N` for `asset_rating` and `asset_tags` | none |

</intent-contract>

## Code Map

- `mjr_am_backend/config.py:62` -- `_env_int(default, *names, min_value, max_value)`; define the two
  constants near the other env-backed limits, with a one-line comment each. Check how config constants are
  re-read in existing tests (e.g. `importlib.reload(config)` or monkeypatching) and follow that pattern.
- `mjr_am_backend/routes/assets/route_actions_delete.py:59` -- `max_requests=20` → delete constant.
- `mjr_am_backend/routes/handlers/assets_impl.py:143` -- `max_requests=30` in `_prepare_asset_op_request` →
  asset-write constant. Import from `mjr_am_backend.config` alongside the existing config imports.
- `docs/SECURITY_ENV_VARS.md:146` -- `## Rate Limiting` section: add a short "Tunable write limits" list
  naming both vars, defaults, range, and when raising them makes sense (bulk curation on a trusted
  instance).
- `docs/SETTINGS_CONFIGURATION.md` -- if it carries an env-var reference list, add both vars there too.
- `CHANGELOG.md` -- Added entry under `## [Unreleased]`.
- Tests: find the existing tests for the delete route and `_prepare_asset_op_request` (grep `asset_delete`,
  `_prepare_asset_op_request` under `tests/`) and put route-wiring tests beside them; config parsing
  tests go in `tests/config/`.

## Tasks & Acceptance

**Execution:**
- [ ] `mjr_am_backend/config.py` -- add `DELETE_RATE_LIMIT_PER_MIN` and `ASSET_WRITE_RATE_LIMIT_PER_MIN` -- the knobs.
- [ ] `mjr_am_backend/routes/assets/route_actions_delete.py`, `mjr_am_backend/routes/handlers/assets_impl.py` -- use them -- wiring.
- [ ] tests -- one test per matrix row.
- [ ] `docs/SECURITY_ENV_VARS.md` (+ `docs/SETTINGS_CONFIGURATION.md` if it lists env vars), `CHANGELOG.md` -- document.

**Acceptance Criteria:**
- Given neither knob set, when a client sends its 21st single delete within 60 s, then it gets RATE_LIMITED exactly as on main.
- Given `MJR_AM_ASSET_WRITE_RATE_LIMIT=600` at startup, when a client sends 100 rating writes within 60 s, then none is rate-limited.
- Given the full Python suite, when run after the change, then no previously passing test fails.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Verification

Worktree Python env: `uv venv -p 3.12 .venv && uv pip install --python .venv/bin/python -r requirements-dev.txt`.

**Commands:**
- `.venv/bin/python -m pytest <new/changed test files> -q` -- expected: pass
- `.venv/bin/python -m pytest tests -q -p no:cacheprovider` -- expected: no new failures vs baseline
- `.venv/bin/python -m ruff check mjr_am_backend tests && .venv/bin/python -m black --check -l 100 <changed files>` -- expected: clean
