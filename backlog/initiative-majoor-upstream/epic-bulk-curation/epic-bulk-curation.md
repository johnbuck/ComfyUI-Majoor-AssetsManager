---
id: 2
type: epic
title: "Bulk curation upstream: delete, tag, rate, trash, and hooks"
covers: []
status: done
after: [epic-upstream-fixes]
---

# Bulk curation upstream: delete, tag, rate, and hooks

## Outcome

Majoor gains the curation operations its grid already implies but its code lacks: multi-card
delete through the existing bulk endpoint, bulk tagging, bulk rating, an "empty trash"
action, and menu hooks another extension can add entries to. All as upstream-ready PRs.

## Done when

Each feature is a merged PR (or closed with reason), with UI wired to the same patterns
Majoor already uses and no private fork needed to use it.

## Boundaries

- Upstream-neutral design: no homelab env vars, no references to our stack; configuration
  follows Majoor's existing settings idioms.
- Bulk operations must respect the rate limits (and, once epic 1 lands, its knobs) with
  visible progress for large selections.
- Reference implementations live in ysalune's ComfyUI-Rating (bulk rate with retry and
  progress toasts) — port the behavior, not the code's coupling.

## References

- ysalune ComfyUI-Rating (`deploy/comfyui-nodes/ComfyUI-Rating/`) for bulk rate behavior
- Majoor's existing bulk delete endpoint (`assets/delete`) and grid context menu
  (`ui/features/contextmenu/GridContextMenu.ts` in v2.5.3) as the wiring points
