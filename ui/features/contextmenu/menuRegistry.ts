/**
 * menuRegistry.ts
 *
 * Public context-menu registry that lets external extensions add entries to
 * Majoor's grid context menus. Exposed on
 * `window.MajoorAssetsManager.api.contextMenu` (see `exposeContextMenuApi`)
 * and announced with the `mjr:api-ready` window event.
 *
 * Guarantees:
 * - Registered items render after Majoor's own items, below one separator,
 *   and only when at least one valid extension item exists.
 * - Registrations are keyed by `id`; re-registering an id replaces it.
 * - Entries sort by `order` (default 100), then registration order.
 * - `items()` throwing or returning a non-array skips that registration with
 *   a `console.warn`; the menu still opens. Invalid items (no usable label)
 *   are dropped silently.
 * - `onSelect` errors (sync throw or rejected promise) are caught and shown
 *   as an error toast; Majoor never crashes on extension code.
 * - Contexts handed to extensions are frozen, DOM-free snapshots: assets are
 *   projected onto a flat frozen `AssetSnapshot`, never shared live state.
 */

import { comfyToast } from "../../app/toast.js";

export const MENU_API_VERSION = 1;

export type MenuId = "grid-asset" | "grid-empty" | "grid-folder";

export type AssetSnapshot = Readonly<{
    id: string;
    filename: string;
    subfolder: string;
    filepath: string;
    type: string;
    kind: string;
    rating: number;
    tags: readonly string[];
}>;

export type MenuContext = Readonly<{
    menu: MenuId;
    asset: AssetSnapshot | null;
    selection: Readonly<{
        ids: string[];
        assets: AssetSnapshot[];
        count: number;
    }>;
    scope: Readonly<{ scope: string; subfolder: string }>;
}>;

type ExtItem = {
    label: string;
    icon?: string;
    disabled?: boolean;
    separatorBefore?: boolean;
    submenu?: ExtItem[];
    onSelect?: (ctx: MenuContext) => unknown;
};

export type MenuRegistration = {
    id: string;
    menus: MenuId[];
    order?: number;
    items(ctx: MenuContext): ExtItem[];
};

type MajoorMenuApi = {
    version: number;
    contextMenu: {
        register(registration: MenuRegistration): () => void;
    };
};

const KNOWN_MENU_IDS = new Set<string>(["grid-asset", "grid-empty", "grid-folder"]);
const DEFAULT_ORDER = 100;
const SELECT_ERROR_TOAST_MS = 4000;

type RegistryEntry = {
    id: string;
    menus: MenuId[];
    order: number;
    seq: number;
    items: (ctx: MenuContext) => ExtItem[];
};

const entries = new Map<string, RegistryEntry>();
let nextSeq = 1;

type ItemFactory = (
    label: any,
    iconClass: any,
    rightHint: any,
    action: any,
    options?: { disabled?: boolean; closeOnSelect?: boolean; submenu?: any[] | null },
) => any;

export function registerContextMenuItems(registration: MenuRegistration): () => void {
    const noop = () => {};
    const source = (registration || {}) as Record<string, any>;

    const id = String(source.id ?? "").trim();
    if (!id) {
        console.warn("[Majoor menuRegistry] register() ignored: 'id' must be a non-empty string.");
        return noop;
    }

    const rawMenus = Array.isArray(source.menus)
        ? source.menus.map((menu: any) => String(menu))
        : [];
    const ignoredMenus = rawMenus.filter((menu: string) => !KNOWN_MENU_IDS.has(menu));
    const menus = rawMenus.filter((menu: string) => KNOWN_MENU_IDS.has(menu)) as MenuId[];
    if (ignoredMenus.length) {
        console.warn(
            `[Majoor menuRegistry] Ignoring unknown menu id(s) in register() for "${id}": ` +
                `${ignoredMenus.join(", ")}.`,
        );
    }
    if (!menus.length) {
        console.warn(
            `[Majoor menuRegistry] register() ignored for "${id}": 'menus' must contain at least ` +
                'one of "grid-asset", "grid-empty", "grid-folder".',
        );
        return noop;
    }

    const items = typeof source.items === "function" ? source.items : null;
    if (!items) {
        console.warn(
            `[Majoor menuRegistry] register() ignored for "${id}": 'items' must be a function.`,
        );
        return noop;
    }

    const rawOrder = Number(source.order);
    const order = Number.isFinite(rawOrder) ? rawOrder : DEFAULT_ORDER;
    const seq = nextSeq++;
    entries.set(id, { id, menus, order, seq, items });

    return () => {
        const current = entries.get(id);
        if (current && current.seq === seq) entries.delete(id);
    };
}

function sortedEntries(): RegistryEntry[] {
    return Array.from(entries.values()).sort((a, b) =>
        a.order !== b.order ? a.order - b.order : a.seq - b.seq,
    );
}

function assetSnapshot(asset: any): AssetSnapshot | null {
    if (!asset || typeof asset !== "object") return null;
    const tags = Array.isArray(asset.tags)
        ? asset.tags.filter((tag: any) => typeof tag === "string")
        : [];
    const rating = Number(asset.rating);
    return Object.freeze({
        id: String(asset.id ?? ""),
        filename: String(asset.filename ?? ""),
        subfolder: String(asset.subfolder ?? ""),
        filepath: String(asset.filepath ?? ""),
        type: String(asset.type || asset.source || ""),
        kind: String(asset.kind ?? ""),
        rating: Number.isFinite(rating) ? rating : 0,
        tags: Object.freeze(tags),
    });
}

export function createMenuContext(
    menu: MenuId,
    asset: object | null,
    ids: readonly any[],
    assets: readonly any[],
    scope: string,
    subfolder: string,
): MenuContext {
    const frozenIds = Object.freeze(
        (Array.isArray(ids) ? ids : []).map((id) => String(id ?? "")).filter(Boolean),
    ) as unknown as string[];
    const frozenAssets = Object.freeze(
        (Array.isArray(assets) ? assets : [])
            .filter((entry) => entry && typeof entry === "object")
            .map((entry) => assetSnapshot(entry) as AssetSnapshot),
    ) as unknown as AssetSnapshot[];

    const count = frozenAssets.length || frozenIds.length;
    const context: MenuContext = {
        menu,
        asset: assetSnapshot(asset),
        selection: Object.freeze({
            ids: frozenIds,
            assets: frozenAssets,
            count,
        }),
        scope: Object.freeze({
            scope: String(scope ?? ""),
            subfolder: String(subfolder ?? ""),
        }),
    };
    return Object.freeze(context);
}

function toastSelectError(error: unknown): void {
    console.warn("[Majoor menuRegistry] Extension menu onSelect failed.", error);
    try {
        const source = error as Record<string, any> | null;
        const message =
            (source &&
                typeof source === "object" &&
                typeof source.message === "string" &&
                source.message) ||
            String(error);
        comfyToast(message, "error", SELECT_ERROR_TOAST_MS);
    } catch {
        // Never let error reporting itself crash the menu.
    }
}

function runOnSelect(onSelect: (ctx: MenuContext) => unknown, ctx: MenuContext): void {
    try {
        const result = onSelect(ctx);
        if (result && typeof (result as any).then === "function") {
            Promise.resolve(result).catch((error: unknown) => toastSelectError(error));
        }
    } catch (error) {
        toastSelectError(error);
    }
}

function convertExtItem(
    extItem: any,
    ctx: MenuContext,
    createItem: ItemFactory,
    createSeparator: () => any,
): any | null {
    if (!extItem || typeof extItem !== "object") return null;
    const label = extItem.label;
    if (typeof label !== "string" || !label.trim()) return null;

    const submenuSource = Array.isArray(extItem.submenu) ? extItem.submenu : [];
    const submenu: any[] = [];
    for (const child of submenuSource) {
        const converted = convertExtItem(child, ctx, createItem, createSeparator);
        if (!converted) continue;
        if (child && typeof child === "object" && child.separatorBefore === true) {
            submenu.push(createSeparator());
        }
        submenu.push(converted);
    }

    const action =
        typeof extItem.onSelect === "function" ? () => runOnSelect(extItem.onSelect, ctx) : null;
    return createItem(
        label,
        typeof extItem.icon === "string" && extItem.icon ? extItem.icon : null,
        null,
        action,
        {
            disabled: extItem.disabled === true,
            submenu: submenu.length ? submenu : null,
        },
    );
}

export function buildExtensionItems(
    menuId: MenuId,
    ctx: MenuContext,
    createItem: ItemFactory,
    createSeparator: () => any,
): any[] {
    const collected: any[] = [];
    for (const entry of sortedEntries()) {
        if (!entry.menus.includes(menuId)) continue;

        let extItems: any;
        try {
            extItems = entry.items(ctx);
        } catch (error) {
            console.warn(
                `[Majoor menuRegistry] Registration "${entry.id}" items() threw for menu ` +
                    `"${menuId}"; skipping it.`,
                error,
            );
            continue;
        }
        if (!Array.isArray(extItems)) {
            console.warn(
                `[Majoor menuRegistry] Registration "${entry.id}" items() returned a non-array ` +
                    `for menu "${menuId}"; skipping it.`,
                { value: extItems },
            );
            continue;
        }

        for (const extItem of extItems) {
            const converted = convertExtItem(extItem, ctx, createItem, createSeparator);
            if (!converted) continue;
            if (
                extItem &&
                typeof extItem === "object" &&
                extItem.separatorBefore === true &&
                collected.length
            ) {
                collected.push(createSeparator());
            }
            collected.push(converted);
        }
    }

    if (!collected.length) return [];
    return [createSeparator(), ...collected];
}

function createMenuApi(): MajoorMenuApi {
    return {
        version: MENU_API_VERSION,
        contextMenu: {
            register: registerContextMenuItems,
        },
    };
}

export function exposeContextMenuApi(): void {
    if (typeof window === "undefined") return;
    const host = window as any;

    let surface = host.MajoorAssetsManager;
    if (!surface || typeof surface !== "object") {
        surface = {};
        host.MajoorAssetsManager = surface;
    }

    // Always rebind to the current module's registry (an extension reload
    // replaces this module) and re-announce, so extensions always reach the
    // live registry through window.MajoorAssetsManager.api.
    surface.api = createMenuApi();
    try {
        window.dispatchEvent(new CustomEvent("mjr:api-ready", { detail: surface.api }));
    } catch (error) {
        console.warn("[Majoor menuRegistry] Failed to dispatch mjr:api-ready.", error);
    }
}

export function __resetMenuRegistryForTests(): void {
    entries.clear();
    nextSeq = 1;
}
