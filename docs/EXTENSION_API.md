# Extension API - Context Menus

Majoor Assets Manager exposes a small public API that lets other extensions
add entries to Majoor's context menus without patching Majoor's source or
watching its DOM.

The API lives on `window.MajoorAssetsManager.api` and is announced with a
`mjr:api-ready` window event (`event.detail` is the `api` object). Majoor
exposes it early in its setup — before its UI mounts — and fires the event at
that point. Registrations take effect the next time a menu opens; menus that
are already open are not modified. The current API version is `1`
(`api.version === 1`).

## Registering menu entries

```ts
const unregister = api.contextMenu.register({
    id: "my-extension.bulk-rate",
    menus: ["grid-asset"],          // "grid-asset" | "grid-empty" | "grid-folder"
    order: 100,                     // optional, default 100; lower renders first
    items: (ctx) => [
        {
            label: "Rate all 5 stars",
            icon: "pi pi-star",                   // optional PrimeVue icon class
            disabled: ctx.selection.count === 0,  // optional
            onSelect: (ctx) => { /* ... */ },     // receives the same frozen ctx
        },
    ],
});
```

`register` returns an unregister function. Re-registering the same `id`
replaces the earlier registration.

## Context shape

Every `items(ctx)` and `onSelect(ctx)` call receives a frozen snapshot copy:

```ts
type MenuContext = Readonly<{
    menu: "grid-asset" | "grid-empty" | "grid-folder";
    asset: AssetSnapshot | null;          // right-clicked asset (or folder), or null
    selection: Readonly<{
        ids: string[];                    // selected asset ids
        assets: AssetSnapshot[];          // snapshots of the selected assets
        count: number;                    // selection size
    }>;
    scope: Readonly<{ scope: string; subfolder: string }>;  // grid scope ("output", "input", ...)
}>;

type AssetSnapshot = Readonly<{
    id: string;
    filename: string;
    subfolder: string;
    filepath: string;
    type: string;                         // falls back to the asset's source
    kind: string;
    rating: number;                       // finite number, 0 when unknown
    tags: readonly string[];              // frozen
}>;
```

Assets are flat projections, not the live objects: missing fields become
`""` / `0` / `[]`, nested objects (`file_info`, `workflow`, metadata, ...) are
not carried over, and the snapshot never changes when Majoor's state does.
The context contains no DOM nodes and no live Majoor state: mutating any part
of it (or of the snapshots it carries) throws in strict mode and changes
nothing.

## Item shape

```ts
type ExtItem = {
    label: string;                        // required; items without a usable label are dropped
    icon?: string;                        // PrimeVue icon class, e.g. "pi pi-star"
    disabled?: boolean;
    separatorBefore?: boolean;            // draw a separator above this item
    submenu?: ExtItem[];                  // nested entries, rendered like Majoor submenus
    onSelect?: (ctx: MenuContext) => unknown;   // return value ignored; errors are toasted
};
```

## Guarantees

- Extension items render after all of Majoor's own items, below a single
  separator, and only when at least one valid extension item exists.
- Entries sort by `order` (default `100`), then registration order.
- Menus filter by id: an entry registered for `"grid-folder"` never appears in
  the asset or empty-grid menus, and vice versa. Unknown menu ids (including
  `"viewer"` — the classic viewer was removed) are ignored with a
  `console.warn`; the registration still applies to any valid ids listed.
- If `items()` throws or returns a non-array, that registration is skipped
  with a `console.warn` and the menu still opens. Invalid items (no usable
  `label`) are dropped silently.
- If `onSelect` throws synchronously or returns a rejected promise, Majoor
  shows an error toast and keeps running.
- With no registrations, every menu is byte-for-byte what Majoor ships.

## Example extension

```ts
// == ComfyUI extension ==
async function setup() {
    const api = window.MajoorAssetsManager?.api;
    if (api?.version !== 1) return;              // wait for `mjr:api-ready` instead
    api.contextMenu.register({
        id: "acme.bulk-tag",
        menus: ["grid-asset"],
        items: (ctx) => [
            { label: `ACME: tag ${ctx.selection.count} assets`,
              onSelect: (c) => console.log(c.selection.ids) },
        ],
    });
}
```

Extensions that load before Majoor can listen for the event:

```ts
window.addEventListener("mjr:api-ready", (event) => {
    event.detail.contextMenu.register({ /* ... */ });
});
```

## Related

- [Documentation index](DOCUMENTATION_INDEX.md)
- [Changelog](../CHANGELOG.md)
