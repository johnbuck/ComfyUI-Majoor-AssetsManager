---
title: 'ExifTool rating/tag writes replace list tags instead of appending'
type: 'bugfix'
ticket: '2'
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
branch: 'fix/exiftool-tag-dedup'
worktree: '/home/trumble/.paseo/worktrees/1ldb4s2k/fix-exiftool-tag-dedup'
---

<intent-contract>

## Intent

**Problem:** On upstream/main (verified 2026-11-03 at 599b47df, real ExifTool 12.x) three successive
rating/tag saves — `["cat"]`, `["cat","dog"]`, `["dog"]` — leave 16 entries in `XMP:Subject` and
`IPTC:Keywords` (e.g. `cat` ×10, `cat; dog` ×2) instead of `["dog"]`. Three causes compound:
(1) `_append_metadata_write_args` writes a list as `-TAG=` then `-TAG+=item`; `+=` appends to the values
already in the file. (2) The tag payload also writes unqualified `Keywords`/`Subject` as a joined string,
which ExifTool resolves to the same list tags, adding a `"a; b"` item. (3) `_write_exiftool_payload`
passes `preserve_workflow=True`, adding `-tagsFromFile @`, which copies every existing tag back, so old
list items rejoin the new list.

**Approach:** Fix all three in one change: list values become one plain `-TAG=item` per item (bare
`-TAG=` only for an empty list, which deletes); drop the unqualified `Keywords`/`Subject` payload keys;
the rating/tags write stops using `-tagsFromFile @`. After any number of saves the file holds exactly the
latest tag set, and ComfyUI's PNG `prompt`/`workflow` text chunks survive.

## Boundaries & Constraints

**Always:** Keep `ExifTool.write`'s signature and the `preserve_workflow` parameter (other callers,
e.g. `routes/handlers/batch_zip.py`, keep their behaviour). Result[T] error pattern unchanged. Synthetic
fixtures only (generate PNGs with Pillow in the test). Black 100, Ruff, MyPy clean.

**Never:** Do not change rating semantics, tag normalisation (`_normalize_tags`), the DB side of tag
saves, or Windows `XPKeywords`/`Microsoft:Category` keys. No homelab references in code, comments, tests,
or commit text.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| List value | `{"XMP:Subject": ["a", None, "b"]}` | args contain `-XMP:Subject=a`, `-XMP:Subject=b`; no `+=`, no bare `-XMP:Subject=` | none |
| Empty list | `{"XMP:Subject": []}` | args contain bare `-XMP:Subject=` (clears) | none |
| List of only blanks/None | `{"XMP:Subject": [None, ""]}` | bare `-XMP:Subject=` | none |
| Payload keys | `_build_exiftool_rating_tags_payload(5, ["a"])` and `(5, [])` | no `Keywords`/`Subject` keys | none |
| Tag write command | `write_exif_rating_tags` | `ExifTool.write` called with `preserve_workflow=False` | none |
| Real ExifTool, repeated saves | synthetic PNG with `prompt`/`workflow` tEXt; saves `["cat"]`, `["cat","dog"]`, `["dog"]` | `XMP:Subject` and `IPTC:Keywords` read back exactly `["dog"]`; `prompt`/`workflow` chunks unchanged | test skips when `exiftool` not on PATH |
| Real ExifTool, clear | after tags, save `[]` | no `XMP:Subject` remaining | skip without exiftool |

</intent-contract>

## Code Map

- `mjr_am_backend/adapters/tools/exiftool.py:895` -- `_append_metadata_write_args`: the list branch
  (`-TAG=` then `-TAG+=item`) is cause 1. `_build_write_command` (line ~887) adds `-tagsFromFile @` when
  `preserve_workflow` is true; leave it as is.
- `mjr_am_backend/features/tags/sync.py:79` -- `_build_exiftool_rating_tags_payload`: remove the
  `"Keywords"`/`"Subject"` entries in both the main dict and the empty-tags branch (cause 2).
- `mjr_am_backend/features/tags/sync.py:113` -- `_write_exiftool_payload`: `preserve_workflow=True` →
  `False`, with a short comment on why (cause 3).
- `tests/features/test_exiftool_adapter.py:~259` -- existing `_build_write_command` assertion with
  `["a", None, "b"]`; extend for the new list semantics.
- `tests/features/test_tags_sync.py:37` -- `test_build_exif_payload_empty_tags` asserts
  `payload["Keywords"] == ""`; update to assert the keys are absent.
- `CHANGELOG.md` -- Fixed entry under `## [Unreleased]`.

## Tasks & Acceptance

**Execution:**
- [ ] `mjr_am_backend/adapters/tools/exiftool.py` -- list branch writes plain `=` per item, bare `=` only when no items remain -- cause 1.
- [ ] `mjr_am_backend/features/tags/sync.py` -- drop unqualified keys; `preserve_workflow=False` -- causes 2 and 3.
- [ ] `tests/features/test_exiftool_adapter.py`, `tests/features/test_tags_sync.py` -- unit tests for the matrix rows that do not need ExifTool.
- [ ] `tests/features/test_tags_sync_exiftool_roundtrip.py` (new) -- real-ExifTool round trip for the last two matrix rows, `pytest.mark.skipif(shutil.which("exiftool") is None, ...)`.
- [ ] `CHANGELOG.md` -- Unreleased Fixed entry.

**Acceptance Criteria:**
- Given the new and updated tests, when run against unpatched upstream/main with ExifTool present, then the list-argument, payload-key, and round-trip tests fail.
- Given the full Python suite, when run after the change, then no previously passing test fails.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Verification

Worktree Python env: `uv venv -p 3.12 .venv && uv pip install --python .venv/bin/python -r requirements-dev.txt`.
Host may lack exiftool; the orchestrator runs the round trip in the gate container (has exiftool).

**Commands:**
- `.venv/bin/python -m pytest tests/features/test_exiftool_adapter.py tests/features/test_tags_sync.py tests/features/test_tags_sync_exiftool_roundtrip.py -q` -- expected: pass (round trip may skip on host)
- `.venv/bin/python -m pytest tests -q -p no:cacheprovider` -- expected: no new failures vs baseline
- `.venv/bin/python -m ruff check mjr_am_backend tests && .venv/bin/python -m black --check -l 100 <changed files>` -- expected: clean
