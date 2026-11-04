---
title: 'Public context-menu registry so extensions can add menu items'
type: 'feature'
ticket: '1'
created: '2026-11-04'
status: 'built'
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
branch: 'feat/context-menu-hooks'
worktree: '/home/trumble/.paseo/worktrees/1ldb4s2k/feat-context-menu-hooks'
design_open_questions: 'drafts/2.1-issue.md "Questions for you" (window global vs ComfyUI extension hook; menu id granularity; API version). Built to the proposal; maintainer may redirect.'
---

<intent-contract>

## Intent

**Problem:** On upstream/main (599b47df) no extension surface exists for Majoor's context menus (no
registry, no `window` API; survey 2026-11-04). Menus are rebuilt from plain item objects
(`createItem`, `ui/features/contextmenu/GridContextMenu.ts:92–118`) on every open and rendered by Vue
teleported to `<body>`, so external extensions (e.g. a bulk-rating extension) must DOM-watch with a
`MutationObserver` and read `window.__MJR_LAST_SELECTION_GRID__` — fragile across Majoor updates.

**Approach:** A small registry (`menuRegistry.ts`) that Majoor's grid and viewer menu builders consult on
every open, exposed as `window.MajoorAssetsManager.api.contextMenu` (+ `api.version = 1`) and announced
with a `mjr:api-ready` window event. Registered items get a frozen, DOM-free context and render exactly
like Majoor's own, after a separator, below Majoor's items.

## Boundaries & Constraints

**Always:** Public API (exact):
```ts
api.version === 1
api.contextMenu.register({ id: string, menus: MenuId[], order?: number,
                           items(ctx: MenuContext): ExtItem[] }): () => void   // returns unregister
type MenuId = "grid-asset" | "grid-empty" | "grid-folder" | "viewer"
type MenuContext = Readonly<{ menu: MenuId, asset: object | null,
                              selection: Readonly<{ ids: string[], assets: object[], count: number }>,
                              scope: Readonly<{ scope: string, subfolder: string }> }>
type ExtItem = { label: string, icon?: string, disabled?: boolean,
                 separatorBefore?: boolean, submenu?: ExtItem[], onSelect?: (ctx) => unknown }
```
Re-registering an `id` replaces it. Items sort by `order` (default 100) then registration order. All
extension items go after Majoor's items, preceded by one separator (only when ≥1 extension item).
`items()` throwing or returning a non-array → that registration skipped + `console.warn`, menu still
opens; invalid items (no string label) dropped. `onSelect` sync throw or rejected promise → caught,
`comfyToast` error, no crash. `ctx` objects are frozen copies (no DOM nodes, no live Majoor state).
`window.MajoorAssetsManager` set once at UI startup (merge, do not clobber an existing object);
`mjr:api-ready` dispatched with `detail = api`. Existing items, ordering and behaviour unchanged when no
registrations. Vitest coverage; ESLint/Prettier clean; dist rebuilt in a final separate commit.

**Never:** No backend changes, no Pinia store for this, no changes to Majoor's own menu items, no removal
of `__MJR_LAST_SELECTION_GRID__` or `mjr-close-all-menus` (other extensions rely on them). No panel
filter-bar menu integration in this change. Never run node/npm on the host.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No registrations | open any menu | items identical to before | none |
| One item, grid-asset | register `{menus:["grid-asset"], items:()=>[{label:"X"}]}` | Majoor items, separator, "X" | none |
| Menu filter | registered for `viewer` only | grid menus unchanged; viewer shows item | none |
| Ordering | A order 200, B order 50 | B's items before A's | none |
| Replace by id | register id "a" twice | only the second registration renders | none |
| Unregister | call returned fn | item gone on next open | none |
| items() throws | `items(){throw}` | menu opens without that registration | `console.warn` |
| Bad item | `[{}, {label:"Y"}]` | only "Y" rendered | dropped silently |
| onSelect rejects | `onSelect: async()=>{throw}` | toast error; menu closes normally | caught |
| Context shape | grid-asset with 3 selected | `ctx.selection.count===3`, `ids` strings, `Object.isFrozen(ctx)` | none |
| Submenu | item with `submenu:[{label:"s"}]` | rendered as Majoor submenu | none |
| API exposure | UI startup | `window.MajoorAssetsManager.api.version===1`; `mjr:api-ready` fired once | none |

</intent-contract>

## Code Map

- New `ui/features/contextmenu/menuRegistry.ts` -- registry, validation, context freezing,
  `buildExtensionItems(menuId, ctx, createItem, createSeparator)` adapter to Majoor item objects.
- `ui/features/contextmenu/GridContextMenu.ts:1841–1909` (`bindGridContextMenu` handler) -- after
  `_buildEmptyGridItems` / `_buildFolderItems` / `_buildAssetItems`, append registry items for
  `grid-empty` / `grid-folder` / `grid-asset`. Context from `_getSelectionSnapshot` (881–892),
  `gridContainer.dataset.mjrScope` / `mjrSubfolder`. Item shape: `createItem(label, iconClass, rightHint,
  action, {disabled, submenu})` (92–111).
- `ui/features/viewer/ViewerContextMenu.ts:162` (`createViewerMenuItems`) and its open site (~461) --
  append `viewer` registry items; viewer selection = the shown asset.
- Rendering: `ui/vue/components/grid/GridContextMenu.vue` and the viewer equivalent already render any
  item/separator/submenu — no Vue change expected.
- `ui/entry.ts` -- expose `window.MajoorAssetsManager.api` and dispatch `mjr:api-ready` once, at the point
  where the UI is initialised (find the existing setup hook there).
- Toast: existing `comfyToast` import used by GridContextMenu.
- New `docs/EXTENSION_API.md` -- the API, context shape, guarantees, and a ≤15-line example extension;
  link it from `docs/DOCUMENTATION_INDEX.md`.
- Tests: new `ui/tests/menu_registry.vitest.ts` (registry unit) and a wiring test that drives
  `bindGridContextMenu` with a stub grid/card (see `ui/tests/grid_context_menu_tones.vitest.ts` patterns).
- `CHANGELOG.md` -- Unreleased → New Features.

## Tasks & Acceptance

**Execution:**
- [ ] `ui/features/contextmenu/menuRegistry.ts` -- registry + adapter.
- [ ] `GridContextMenu.ts`, `ViewerContextMenu.ts` -- consult registry.
- [ ] `ui/entry.ts` -- global API + ready event.
- [ ] tests -- one per matrix row.
- [ ] `docs/EXTENSION_API.md`, `docs/DOCUMENTATION_INDEX.md`, `CHANGELOG.md`.
- [ ] final separate commit `chore(dist): rebuild`.

**Acceptance Criteria:**
- Given a tiny example extension that only calls `register(...)`, when the user right-clicks a card, then its item appears and its `onSelect` receives the selection — with no change to Majoor's source.
- Given the full Vitest suite, when run after the change, then no previously passing test fails.

## Implementation Notes

- Built by GLM-5.3 sub-agent (Paseo) in worktree `feat-context-menu-hooks`; tests first (suite failed to resolve `menuRegistry.js` on main).
- First pass Prettier-reformatted whole files; reverted to upstream lines with functional edits only (gate rule: no added Prettier drift; main is not Prettier-clean).
- `_ensureRightClickSelection` is dead code on main, so extension `ctx.selection` matches the snapshot Majoor's own items use (right-clicking an unselected card keeps the prior selection — same as Majoor's "Delete N files").
- Design deviates from CONTRIBUTING's "Pinia, no global mutable objects" by necessity (a cross-extension surface must be a global); this is question 1 in the design issue draft and is called out in the PR draft.

## Plan Change Log

### 2026-11-04 — amendments from quick review
- **Trigger:** `ctx.asset` / `ctx.selection.assets` were shallow-frozen spreads of live Majoor asset objects, so nested objects (`file_info`, `workflow`, metadata) were live, mutable state, which breaks the "frozen, no live state" contract. Deep copies per menu open are too costly for large selections. **Amended:** context assets are a documented, flat, fully frozen projection, `AssetSnapshot = Readonly<{ id: string, filename: string, subfolder: string, filepath: string, type: string, kind: string, rating: number, tags: readonly string[] }>` (missing fields → "" / 0 / []). `MenuContext.asset: AssetSnapshot | null`, `selection.assets: AssetSnapshot[]`. Viewer `ctx.scope` is `{scope: "", subfolder: ""}` (the viewer has no grid scope). Known-bad state avoided: extensions mutating Majoor's live assets through the context.
- **KEEP:** registry semantics, ordering, isolation, the window API + `mjr:api-ready`, item adapter via `createItem`, grid/viewer wiring points, no reformatting of pre-existing lines, separate dist commit.

## Review Triage Log

### 2026-11-04 — Review pass
- verdicts: 7 findings — high 0, medium 1, low 5, false 0, maybe-false 0, rejected 1
- findings:
  - `[medium]` `[bad_plan]` ctx assets were shallow-frozen spreads; nested objects stayed live Majoor state — plan amended (Plan Change Log): flat frozen `AssetSnapshot` projection; re-derived in 21126b5e.
  - `[low]` `[patch]` leading `separatorBefore` doubled the separator — skipped when nothing collected yet; test added.
  - `[low]` `[patch]` docs claimed `mjr:api-ready` fires after UI init; it fires early in setup — docs corrected (registrations apply on next menu open).
  - `[low]` `[patch]` viewer passed asset type/source as `ctx.scope` — viewer now passes empty scope; documented.
  - `[low]` `[patch]` re-expose short-circuit left the window API bound to a stale registry after reload — always rebind and re-dispatch; test updated.
  - `[low]` `[patch]` unknown menu ids mixed with valid ones dropped silently — `console.warn` listing ignored ids; test added.
  - `[low]` `[reject]` window global + module Map conflicts with Pinia-first convention — sanctioned by plan, it is the open design question for the maintainer (issue draft Q1), and is disclosed in the PR draft.

## Verification

Node runs ONLY in the container: `sh /tmp/majoor-gate/node.sh <worktree> <cmd...>`.

**Commands:**
- `sh /tmp/majoor-gate/node.sh $PWD npx vitest run ui/tests/menu_registry.vitest.ts` -- expected: pass
- `sh /tmp/majoor-gate/node.sh $PWD npx vitest run` -- expected: all pass
- `sh /tmp/majoor-gate/node.sh $PWD npx eslint <changed ui files>` / `npx prettier --check <changed ui files>` -- expected: clean
- `sh /tmp/majoor-gate/node.sh $PWD npx tsc -p tsconfig.json --noEmit` if the repo typechecks UI (check package.json scripts) -- expected: no new errors
- `sh /tmp/majoor-gate/node.sh $PWD npm run build` -- expected: succeeds

## Auto Run Result

- **Summary:** public context-menu registry. Extensions call `window.MajoorAssetsManager.api.contextMenu.register({id, menus, order, items(ctx)})` (announced by `mjr:api-ready`). Items render after Majoor's own, below one separator, in grid-asset/grid-empty/grid-folder/viewer menus. The context is a frozen, DOM-free `AssetSnapshot` projection. A throwing or invalid extension never breaks the menu.
- **Branch:** `feat/context-menu-hooks` @ 366dac10 (feat 21126b5e, docs 3173b61d, chore(dist) 366dac10) off upstream/main 599b47df. Not pushed upstream; nothing posted.
- **Files:** `ui/features/contextmenu/menuRegistry.ts` (new); `ui/features/contextmenu/GridContextMenu.ts`, `ui/features/viewer/ViewerContextMenu.ts`, `ui/entry.ts` (wiring); `ui/tests/menu_registry.vitest.ts` (new, 24 tests); `docs/EXTENSION_API.md` (new), `docs/DOCUMENTATION_INDEX.md`, `CHANGELOG.md`; `dist/`.
- **Review:** 5 low patches, 1 medium via plan amendment, 0 deferred, 1 rejected. Follow-up review recommended: false (one medium re-derived through the plan, no high).
- **Verification:** full gate in `node:24-bookworm`: pytest 1931 passed; Vitest 882 passed; Ruff/Mypy/Bandit/Xenon/ESLint/npm audit clean; Prettier drift on edited files equal to main, new files clean; tsc clean (agent).
- **Open design questions (for the maintainer):** window global vs ComfyUI extension hook; menu id granularity; API versioning. See `drafts/2.1-issue.md`.
