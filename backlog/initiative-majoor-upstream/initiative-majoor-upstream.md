---
id: 1
type: initiative
title: "Contribute to Majoor upstream: the fixes we carry, and the bulk curation it lacks"
status: in-progress
---

# Contribute to Majoor upstream: the fixes we carry, and the bulk curation it lacks

## Intent

Majoor (v2.5.3, pinned) runs as the asset manager for the homelab's ComfyUI lanes. We carry
twelve local patches for real defects and limits; the aim here is to move the generally
useful ones upstream through PRs from this fork, and to build the bulk curation operations
Majoor lacks — bulk delete through its bulk endpoint, bulk tagging, bulk rating, a trash
"empty" action, and menu hooks so other extensions can extend Majoor — as upstream-ready
features rather than private patches.

## Source material

- The deployed, patched copy: `~/Projects/ysalune/deploy/comfyui-nodes/ComfyUI-Majoor-AssetsManager`
  (+ `patches/`, `VENDOR.md` records every divergence with its reason).
- Our reference implementations of the bulk operations: ComfyUI-Rating in the same repo
  (bulk "Rate image", the rating worker's retry/pacing, trash expiry tooling).
- Upstream main is AHEAD of the pinned v2.5.3 — every port targets current main, not the pin.

## Boundaries

- Upstream-first: a change lands here as a branch off upstream/main and a PR to
  MajoorWaldi/ComfyUI-Majoor-AssetsManager. The homelab keeps running its vendored tree;
  it re-vendors at a release that contains the change and drops the local patch.
- No homelab-specific hardening in PRs (the phone-home removal and path containment stay
  private patches).
- Character content from the homelab never enters this repo — fixtures and tests use
  synthetic files only.

## Done when

Every ticket here is either merged upstream, closed as rejected (with the reason recorded),
or shipped in a release the homelab has re-vendored.

## Upstream conventions (docs/CONTRIBUTING.md, README § Contributing, CI)

Every ticket here follows these, in this order:

1. **Issue first**: open an upstream issue per bug/feature before any PR, with a runnable
   reproducer; for the bulk-curation features, propose the design in the issue and wait for
   maintainer response (they are new surface, not fixes).
2. **Re-verify on main**: upstream main is far ahead of our pinned v2.5.3 and its Unreleased
   changelog shows heavy churn — confirm the bug still exists on main before porting.
3. **Branches and commits**: `fix/x` / `feat/x` off main; Conventional Commits, one logical
   change per commit.
4. **Quality gate** (`npm run quality`) must pass: Black (line length 100), Ruff, MyPy +
   Pyright, ESLint/Prettier, security scanners; pytest and Vitest (`ui/tests/*.vitest.mjs`);
   coverage floors Python 68% lines / 70% functions, security-critical code 100%.
5. **House patterns**: backend errors use `Result[T]` (never raise to UI); never import
   ComfyUI's server.py (ADR-002); Vue 3 Composition API + Pinia for UI state.
6. **Docs and changelog**: behavior changes update docs/ and add a CHANGELOG.md entry under
   Unreleased.
7. **UI changes rebuild dist/** — `npm run build`; on this host, every npm/node command
   runs inside the `node:24-bookworm` container, never on the host (homelab rule).
8. **Cadence**: 2-week dev window then 2-week freeze; submit PRs early in a dev window;
   the hotfix lane is only for security/data-loss/startup breaks.
9. **Fixtures**: synthetic files only — no homelab or character content ever enters this
   repo or its issues/PRs.
