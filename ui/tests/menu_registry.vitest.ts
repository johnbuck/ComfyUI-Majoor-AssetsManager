// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { comfyToast } from "../app/toast.js";
import { t } from "../app/i18n.js";
import { bindGridContextMenu } from "../features/contextmenu/GridContextMenu.js";
import {
    closeAllGridContextMenus,
    gridContextMenuState,
} from "../features/contextmenu/gridContextMenuState.js";
import {
    MENU_API_VERSION,
    __resetMenuRegistryForTests,
    buildExtensionItems,
    createMenuContext,
    exposeContextMenuApi,
    registerContextMenuItems,
} from "../features/contextmenu/menuRegistry.js";

vi.mock("../app/toast.js", () => ({
    comfyToast: vi.fn(),
}));

let _nextFakeId = 1;
const fakeCreateItem = (
    label: any,
    iconClass: any,
    rightHint: any,
    action: any,
    options: Record<string, any> = {},
) => ({
    id: `fake-item-${_nextFakeId++}`,
    type: "item",
    label: String(label || ""),
    iconClass: iconClass ? String(iconClass) : "",
    rightHint: rightHint ? String(rightHint) : "",
    disabled: !!options.disabled,
    closeOnSelect: true,
    submenu: Array.isArray(options.submenu) ? options.submenu : null,
    action: typeof action === "function" ? action : null,
});
const fakeCreateSeparator = () => ({
    id: `fake-separator-${_nextFakeId++}`,
    type: "separator",
});

const labelsOf = (items: any[]) =>
    items.map((item) => (item?.type === "separator" ? "|" : String(item?.label || "")));

const unitCtx = () =>
    createMenuContext("grid-asset", { id: "v1" }, ["v1"], [{ id: "v1" }], "output", "");

function buildGridHarness({ selectedIds = ["a1"] as string[] } = {}) {
    const assets = [
        { id: "a1", filename: "a1.png", filepath: "sub/a1.png", kind: "image", type: "output" },
        { id: "a2", filename: "a2.png", filepath: "sub/a2.png", kind: "image", type: "output" },
        { id: "a3", filename: "a3.png", filepath: "sub/a3.png", kind: "image", type: "output" },
    ];
    const grid = document.createElement("div");
    grid.dataset.mjrScope = "output";
    grid.dataset.mjrSubfolder = "sub";
    (grid as any)._mjrGetAssets = () => assets;
    (grid as any)._mjrGetSelectedAssets = () =>
        assets.filter((asset) => selectedIds.includes(String(asset.id)));
    grid.dataset.mjrSelectedAssetIds = JSON.stringify(selectedIds);
    const card = document.createElement("div");
    card.className = "mjr-asset-card";
    (card as any)._mjrAsset = assets[0];
    grid.appendChild(card);
    document.body.appendChild(grid);

    const unbind = bindGridContextMenu({
        gridContainer: grid,
        getState: () => ({ scope: "output" }),
    });
    const openMenu = (target: Element = card) => {
        target.dispatchEvent(
            new MouseEvent("contextmenu", {
                bubbles: true,
                cancelable: true,
                clientX: 8,
                clientY: 8,
            }),
        );
        return gridContextMenuState.main.items;
    };
    return { grid, card, assets, unbind, openMenu };
}

describe("menu registry unit", () => {
    beforeEach(() => {
        __resetMenuRegistryForTests();
    });

    it("returns no nodes when nothing is registered", () => {
        expect(
            buildExtensionItems("grid-asset", unitCtx(), fakeCreateItem, fakeCreateSeparator),
        ).toEqual([]);
    });

    it("sorts registrations by order (default 100) then registration order", () => {
        registerContextMenuItems({
            id: "a",
            menus: ["grid-asset"],
            order: 200,
            items: () => [{ label: "A" }],
        });
        registerContextMenuItems({
            id: "b",
            menus: ["grid-asset"],
            order: 50,
            items: () => [{ label: "B" }],
        });
        registerContextMenuItems({ id: "x", menus: ["grid-asset"], items: () => [{ label: "X" }] });
        registerContextMenuItems({ id: "y", menus: ["grid-asset"], items: () => [{ label: "Y" }] });

        const items = buildExtensionItems(
            "grid-asset",
            unitCtx(),
            fakeCreateItem,
            fakeCreateSeparator,
        );
        expect(labelsOf(items)).toEqual(["|", "B", "X", "Y", "A"]);
    });

    it("re-registering an id replaces the earlier registration", () => {
        registerContextMenuItems({
            id: "a",
            menus: ["grid-asset"],
            items: () => [{ label: "first" }],
        });
        registerContextMenuItems({
            id: "a",
            menus: ["grid-asset"],
            items: () => [{ label: "second" }, { label: "second-b" }],
        });

        const items = buildExtensionItems(
            "grid-asset",
            unitCtx(),
            fakeCreateItem,
            fakeCreateSeparator,
        );
        expect(labelsOf(items)).toEqual(["|", "second", "second-b"]);
    });

    it("the returned function unregisters the items", () => {
        const unregister = registerContextMenuItems({
            id: "a",
            menus: ["grid-asset"],
            items: () => [{ label: "gone" }],
        });
        expect(
            buildExtensionItems("grid-asset", unitCtx(), fakeCreateItem, fakeCreateSeparator)
                .length,
        ).toBeGreaterThan(0);
        unregister();
        expect(
            buildExtensionItems("grid-asset", unitCtx(), fakeCreateItem, fakeCreateSeparator),
        ).toEqual([]);
    });

    it("an unregister function from a replaced registration does not remove the replacement", () => {
        const firstUnregister = registerContextMenuItems({
            id: "a",
            menus: ["grid-asset"],
            items: () => [{ label: "first" }],
        });
        registerContextMenuItems({
            id: "a",
            menus: ["grid-asset"],
            items: () => [{ label: "second" }],
        });
        firstUnregister();
        const items = buildExtensionItems(
            "grid-asset",
            unitCtx(),
            fakeCreateItem,
            fakeCreateSeparator,
        );
        expect(labelsOf(items)).toEqual(["|", "second"]);
    });

    it("items() throwing skips only that registration and warns", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        registerContextMenuItems({
            id: "bad",
            menus: ["grid-asset"],
            items: () => {
                throw new Error("nope");
            },
        });
        registerContextMenuItems({
            id: "good",
            menus: ["grid-asset"],
            items: () => [{ label: "good-item" }],
        });

        const items = buildExtensionItems(
            "grid-asset",
            unitCtx(),
            fakeCreateItem,
            fakeCreateSeparator,
        );
        expect(labelsOf(items)).toEqual(["|", "good-item"]);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"bad"'), expect.any(Error));
        warnSpy.mockRestore();
    });

    it("items() returning a non-array skips that registration and warns", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        registerContextMenuItems({
            id: "broken",
            menus: ["grid-asset"],
            items: () => "not an array" as any,
        });

        expect(
            buildExtensionItems("grid-asset", unitCtx(), fakeCreateItem, fakeCreateSeparator),
        ).toEqual([]);
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('"broken"'),
            expect.anything(),
        );
        warnSpy.mockRestore();
    });

    it("drops items without a usable label, keeps the valid ones", () => {
        registerContextMenuItems({
            id: "mixed",
            menus: ["grid-asset"],
            items: () => [{} as any, { label: "Y" }, null as any, 42 as any],
        });

        const items = buildExtensionItems(
            "grid-asset",
            unitCtx(),
            fakeCreateItem,
            fakeCreateSeparator,
        );
        expect(labelsOf(items)).toEqual(["|", "Y"]);
    });

    it("renders submenu items through the adapter", () => {
        registerContextMenuItems({
            id: "sub",
            menus: ["grid-asset"],
            items: () => [
                {
                    label: "Parent",
                    icon: "pi pi-bolt",
                    submenu: [{ label: "s" }, { label: "s2", separatorBefore: true }],
                },
            ],
        });

        const items = buildExtensionItems(
            "grid-asset",
            unitCtx(),
            fakeCreateItem,
            fakeCreateSeparator,
        );
        expect(labelsOf(items)).toEqual(["|", "Parent"]);
        const parent = items[1];
        expect(parent.iconClass).toBe("pi pi-bolt");
        expect(labelsOf(parent.submenu)).toEqual(["s", "|", "s2"]);
        expect(parent.submenu[0].type).toBe("item");
    });

    it("maps onSelect errors (sync throw and rejected promise) to an error toast", async () => {
        const captured: any[] = [];
        registerContextMenuItems({
            id: "boom",
            menus: ["grid-asset"],
            items: () => [
                {
                    label: "Sync",
                    onSelect: () => {
                        throw new Error("sync fail");
                    },
                },
                {
                    label: "Async",
                    onSelect: async () => {
                        throw new Error("kaputt");
                    },
                },
                { label: "Fine", onSelect: (ctx) => captured.push(ctx) },
            ],
        });

        const items = buildExtensionItems(
            "grid-asset",
            unitCtx(),
            fakeCreateItem,
            fakeCreateSeparator,
        );
        const [syncItem, asyncItem, fineItem] = items.slice(1);

        syncItem.action();
        expect(comfyToast).toHaveBeenCalledWith("sync fail", "error", 4000);

        vi.mocked(comfyToast).mockClear();
        asyncItem.action();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(comfyToast).toHaveBeenCalledWith("kaputt", "error", 4000);

        vi.mocked(comfyToast).mockClear();
        fineItem.action();
        expect(comfyToast).not.toHaveBeenCalled();
        expect(captured).toHaveLength(1);
        expect(captured[0].menu).toBe("grid-asset");
    });

    it("createMenuContext projects assets onto a frozen AssetSnapshot", () => {
        const liveAsset = {
            id: "a1",
            kind: "image",
            type: "output",
            source: "unused",
            filename: "a1.png",
            subfolder: "sub",
            filepath: "sub/a1.png",
            rating: 4,
            tags: ["a", "b"],
            file_info: { filepath: "sub/a1.png" },
            workflow: { nodes: [] },
        };
        const ctx = createMenuContext(
            "grid-asset",
            liveAsset,
            ["a1", "a2", "a3"],
            [liveAsset, { id: "a2" }, { id: "a3" }],
            "output",
            "sub/dir",
        );

        expect(Object.isFrozen(ctx)).toBe(true);
        expect(Object.isFrozen(ctx.scope)).toBe(true);
        expect(Object.isFrozen(ctx.selection)).toBe(true);
        expect(Object.isFrozen(ctx.selection.ids)).toBe(true);
        expect(Object.isFrozen(ctx.selection.assets)).toBe(true);
        expect(Object.isFrozen(ctx.asset)).toBe(true);
        expect(Object.isFrozen(ctx.asset!.tags)).toBe(true);
        expect(ctx.menu).toBe("grid-asset");
        expect(ctx.selection.count).toBe(3);
        expect(ctx.selection.ids).toEqual(["a1", "a2", "a3"]);
        expect(ctx.selection.ids.every((id) => typeof id === "string")).toBe(true);
        expect(ctx.asset).not.toBe(liveAsset);
        expect(ctx.asset).toEqual({
            id: "a1",
            filename: "a1.png",
            subfolder: "sub",
            filepath: "sub/a1.png",
            type: "output",
            kind: "image",
            rating: 4,
            tags: ["a", "b"],
        });
        expect((ctx.asset as any).file_info).toBeUndefined();
        expect((ctx.asset as any).workflow).toBeUndefined();
        expect(ctx.selection.assets[0]).not.toBe(liveAsset);
        expect(ctx.selection.assets[0]).toMatchObject({ id: "a1", rating: 4 });
        expect((ctx.selection.assets[0] as any).file_info).toBeUndefined();
        expect(ctx.scope).toEqual({ scope: "output", subfolder: "sub/dir" });

        liveAsset.rating = 1;
        liveAsset.tags.push("c");
        liveAsset.filename = "changed.png";
        expect(ctx.asset!.rating).toBe(4);
        expect(ctx.asset!.tags).toEqual(["a", "b"]);
        expect(ctx.asset!.filename).toBe("a1.png");
    });

    it("createMenuContext derives snapshot fields defensively", () => {
        const ctx = createMenuContext(
            "grid-asset",
            { source: "input", rating: "NaN-ish" },
            [],
            [],
            "",
            "",
        );
        expect(ctx.asset).toEqual({
            id: "",
            filename: "",
            subfolder: "",
            filepath: "",
            type: "input",
            kind: "",
            rating: 0,
            tags: [],
        });
        expect(Object.isFrozen(ctx.asset!.tags)).toBe(true);
    });

    it("a leading separatorBefore item does not double the mandatory separator", () => {
        registerContextMenuItems({
            id: "lead",
            menus: ["grid-asset"],
            items: () => [{ label: "Only", separatorBefore: true }],
        });
        const items = buildExtensionItems(
            "grid-asset",
            unitCtx(),
            fakeCreateItem,
            fakeCreateSeparator,
        );
        expect(labelsOf(items)).toEqual(["|", "Only"]);

        registerContextMenuItems({
            id: "second",
            menus: ["grid-asset"],
            items: () => [{ label: "After", separatorBefore: true }],
        });
        const more = buildExtensionItems(
            "grid-asset",
            unitCtx(),
            fakeCreateItem,
            fakeCreateSeparator,
        );
        expect(labelsOf(more)).toEqual(["|", "Only", "|", "After"]);
    });

    it("warns about unknown menu ids but proceeds with the valid ones", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        registerContextMenuItems({
            id: "mixed",
            menus: ["grid-asset", "nonsense", "viewer", "worse-menu"],
            items: () => [{ label: "OK" }],
        } as any);

        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("nonsense, viewer, worse-menu"),
        );
        const items = buildExtensionItems(
            "grid-asset",
            unitCtx(),
            fakeCreateItem,
            fakeCreateSeparator,
        );
        expect(labelsOf(items)).toEqual(["|", "OK"]);
        warnSpy.mockRestore();
    });

    it("createMenuContext yields an empty frozen selection without assets", () => {
        const ctx = createMenuContext("grid-empty", null, [], [], "", "");
        expect(ctx.asset).toBe(null);
        expect(ctx.selection.count).toBe(0);
        expect(ctx.selection.ids).toEqual([]);
        expect(ctx.selection.assets).toEqual([]);
        expect(Object.isFrozen(ctx)).toBe(true);
    });
});

describe("menu registry wiring", () => {
    beforeEach(() => {
        __resetMenuRegistryForTests();
        vi.clearAllMocks();
    });

    afterEach(() => {
        closeAllGridContextMenus();
        document.body.innerHTML = "";
    });

    it("grid menus are unchanged when nothing is registered (grid-asset)", () => {
        const harness = buildGridHarness();
        const first = labelsOf(harness.openMenu());
        expect(first.length).toBeGreaterThan(0);
        const second = labelsOf(harness.openMenu());
        expect(second).toEqual(first);
        expect(second[second.length - 1]).not.toBe("|");
        harness.unbind();
    });

    it("grid menus are unchanged when nothing is registered (grid-empty)", () => {
        const harness = buildGridHarness();
        const items = harness.openMenu(harness.grid);
        expect(labelsOf(items)).toEqual([t("ctx.createFolderHere", "Create folder here...")]);
        harness.unbind();
    });

    it("registered items appear after Majoor's items, below a separator (grid-asset)", () => {
        const harness = buildGridHarness();
        const baseline = labelsOf(harness.openMenu());

        registerContextMenuItems({
            id: "ext",
            menus: ["grid-asset"],
            items: () => [{ label: "X" }],
        });
        const items = harness.openMenu();

        expect(labelsOf(items).slice(0, baseline.length)).toEqual(baseline);
        expect(items[items.length - 1].label).toBe("X");
        expect(items[items.length - 2].type).toBe("separator");
        harness.unbind();
    });

    it("registered items appear on the empty-grid menu (grid-empty)", () => {
        const harness = buildGridHarness();
        registerContextMenuItems({
            id: "empty-ext",
            menus: ["grid-empty"],
            items: () => [{ label: "EmptyExt" }],
        });
        const items = harness.openMenu(harness.grid);
        expect(labelsOf(items)).toEqual([
            t("ctx.createFolderHere", "Create folder here..."),
            "|",
            "EmptyExt",
        ]);
        harness.unbind();
    });

    it("registered items appear on the folder menu (grid-folder)", () => {
        const folderAsset = {
            id: "f1",
            filename: "folder",
            filepath: "sub/folder",
            kind: "folder",
            type: "output",
        };
        const grid = document.createElement("div");
        grid.dataset.mjrScope = "output";
        grid.dataset.mjrSubfolder = "sub";
        (grid as any)._mjrGetSelectedAssets = () => [];
        (grid as any)._mjrGetAssets = () => [folderAsset];
        const card = document.createElement("div");
        card.className = "mjr-asset-card";
        (card as any)._mjrAsset = folderAsset;
        grid.appendChild(card);
        document.body.appendChild(grid);
        const unbind = bindGridContextMenu({
            gridContainer: grid,
            getState: () => ({ scope: "output" }),
        });

        registerContextMenuItems({
            id: "folder-ext",
            menus: ["grid-folder"],
            items: () => [{ label: "FolderExt" }],
        });
        card.dispatchEvent(
            new MouseEvent("contextmenu", {
                bubbles: true,
                cancelable: true,
                clientX: 8,
                clientY: 8,
            }),
        );
        const items = gridContextMenuState.main.items;
        expect(items[items.length - 1].label).toBe("FolderExt");
        expect(items[items.length - 2].type).toBe("separator");
        unbind();
    });

    it("registration for grid-folder only leaves the other grid menus untouched", () => {
        const harness = buildGridHarness();
        const cardBaseline = labelsOf(harness.openMenu());
        const emptyBaseline = labelsOf(harness.openMenu(harness.grid));

        registerContextMenuItems({
            id: "folder-only",
            menus: ["grid-folder"],
            items: () => [{ label: "FItem" }],
        });

        expect(labelsOf(harness.openMenu())).toEqual(cardBaseline);
        expect(labelsOf(harness.openMenu(harness.grid))).toEqual(emptyBaseline);

        const folderAsset = {
            id: "f1",
            filename: "folder",
            filepath: "sub/folder",
            kind: "folder",
            type: "output",
        };
        const grid = document.createElement("div");
        grid.dataset.mjrScope = "output";
        grid.dataset.mjrSubfolder = "sub";
        (grid as any)._mjrGetSelectedAssets = () => [];
        (grid as any)._mjrGetAssets = () => [folderAsset];
        const card = document.createElement("div");
        card.className = "mjr-asset-card";
        (card as any)._mjrAsset = folderAsset;
        grid.appendChild(card);
        document.body.appendChild(grid);
        const unbind = bindGridContextMenu({
            gridContainer: grid,
            getState: () => ({ scope: "output" }),
        });
        card.dispatchEvent(
            new MouseEvent("contextmenu", {
                bubbles: true,
                cancelable: true,
                clientX: 8,
                clientY: 8,
            }),
        );
        const items = gridContextMenuState.main.items;
        expect(items[items.length - 1].label).toBe("FItem");
        expect(items[items.length - 2].type).toBe("separator");
        unbind();
        harness.unbind();
    });

    it("example extension: item appears on right-click and onSelect receives the selection", () => {
        const harness = buildGridHarness({ selectedIds: ["a1", "a2", "a3"] });
        const received: any[] = [];
        registerContextMenuItems({
            id: "bulk",
            menus: ["grid-asset"],
            items: (ctx) => [
                {
                    label: `Rate ${ctx.selection.count}`,
                    onSelect: (selectCtx) => received.push(selectCtx),
                },
            ],
        });

        const items = harness.openMenu();
        const extItem = items[items.length - 1];
        expect(extItem.label).toBe("Rate 3");
        expect(typeof extItem.action).toBe("function");

        extItem.action();
        expect(received).toHaveLength(1);
        const ctx = received[0];
        expect(ctx.menu).toBe("grid-asset");
        expect(ctx.selection.count).toBe(3);
        expect(ctx.selection.ids).toEqual(["a1", "a2", "a3"]);
        expect(Object.isFrozen(ctx)).toBe(true);
        expect(ctx.asset).not.toBe(harness.assets[0]);
        expect(ctx.asset).toMatchObject({ id: "a1" });
        expect(ctx.scope).toEqual({ scope: "output", subfolder: "sub" });
        harness.unbind();
    });
});

describe("window API exposure", () => {
    beforeEach(() => {
        __resetMenuRegistryForTests();
        delete (window as any).MajoorAssetsManager;
    });

    afterEach(() => {
        delete (window as any).MajoorAssetsManager;
    });

    it("exposes MajoorAssetsManager.api (version 1), merged, re-firing on re-expose", () => {
        const preexisting = { openSettings: () => {} };
        (window as any).MajoorAssetsManager = preexisting;

        const events: any[] = [];
        const listener = (event: any) => events.push(event);
        window.addEventListener("mjr:api-ready", listener);
        try {
            exposeContextMenuApi();

            const host = (window as any).MajoorAssetsManager;
            expect(host).toBe(preexisting);
            expect(host.openSettings).toBeTypeOf("function");
            expect(host.api.version).toBe(1);
            expect(MENU_API_VERSION).toBe(1);
            expect(typeof host.api.contextMenu.register).toBe("function");

            expect(events).toHaveLength(1);
            expect(events[0].detail).toBe(host.api);

            const firstApi = host.api;
            exposeContextMenuApi();
            expect(events).toHaveLength(2);
            expect(events[1].detail).toBe(host.api);
            expect(events[1].detail).not.toBe(firstApi);
            expect(host.openSettings).toBeTypeOf("function");

            const unregister = host.api.contextMenu.register({
                id: "via-api",
                menus: ["grid-asset"],
                items: () => [{ label: "API item" }],
            });
            const items = buildExtensionItems(
                "grid-asset",
                unitCtx(),
                fakeCreateItem,
                fakeCreateSeparator,
            );
            expect(labelsOf(items)).toEqual(["|", "API item"]);
            unregister();
        } finally {
            window.removeEventListener("mjr:api-ready", listener);
        }
    });
});
