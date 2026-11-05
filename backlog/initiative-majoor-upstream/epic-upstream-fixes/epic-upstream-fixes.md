---
id: 1
type: epic
title: "Upstream fixes: port the patches we already proved"
covers: []
status: done
after: []
---

# Upstream fixes: port the patches we already proved

## Outcome

The three defects and limits we carry as private patches are fixed in upstream main through
PRs from this fork, so a future re-vendor drops all three patches.

## Done when

Three PRs merged (or closed with reason): the hidden-folder scan fix, the ExifTool tag
duplication fix, and the configurable rate-limit knobs.

## Boundaries

- Each PR is one branch off upstream/main, one concern, with a reproducer (test or script)
  an upstream maintainer can run.
- Ports adapt to current main, which may have moved since v2.5.3 — re-verify the bug exists
  on main before writing the fix.

## References

- ysalune vendored tree + `patches/` + `VENDOR.md` (as built records for all three)
