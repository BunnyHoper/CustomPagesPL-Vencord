/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import * as DataStore from "@api/DataStore";
import { plugins } from "@api/PluginManager";
import { addServerListElement, removeServerListElement, ServerListRenderPosition } from "@api/ServerList";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { openPluginModal } from "@components/settings";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { findByCodeLazy, findComponentByCodeLazy } from "@webpack";
import { NavigationRouter, Tooltip, useEffect, useRef, useState } from "@webpack/common";
import type { MouseEvent as ReactMouseEvent, ReactElement } from "react";

import { DEFAULT_PAGES } from "./defaults";
import { PagesEditor } from "./PagesEditor";

const Native = IS_DISCORD_DESKTOP
    ? VencordNative.pluginHelpers["Custom Pages"] as PluginNative<typeof import("./native")>
    : null;

export const ROUTE = "/custom-pages";
export const cl = classNameFactory("vc-customPages-");
// On <body> while a page is open in server mode: hides the user panel and un-highlights Home.
const ACTIVE_SERVER_CLASS = cl("server-active");

export interface Page {
    id: string;
    name: string;
    url: string;
    icon: string;
}

export const settings = definePluginSettings({
    pages: {
        type: OptionType.CUSTOM,
        default: DEFAULT_PAGES as Page[],
    },
    pagesEditor: {
        type: OptionType.COMPONENT,
        component: () => <PagesEditor />
    },
    asServer: {
        type: OptionType.BOOLEAN,
        description: "Shows each page as a server icon at the top of the server list and opens it full width, like a whole server.",
        displayName: "Show as servers",
        default: false
    },
    keepLoaded: {
        type: OptionType.BOOLEAN,
        description: "Keeps pages loaded in the background when you leave them.",
        displayName: "Keep loaded in background",
        default: true,
        onChange(value: boolean) {
            if (!value) dropHiddenFrames();
        }
    },
    unloadAfter: {
        type: OptionType.NUMBER,
        description: "Minutes a page stays loaded in the background before it unloads on its own. 0 = never.",
        displayName: "Unload after (minutes)",
        default: 5,
        hidden() {
            return !this.store.keepLoaded;
        },
        isValid(value: number) {
            return value >= 0 || "Use 0 or more minutes.";
        }
    }
});

export function pageUrl(value: string | undefined): string | null {
    const trimmed = (value ?? "").trim();
    if (trimmed === "") return null;
    try {
        const url = new URL(trimmed);
        if (url.protocol !== "http:" && url.protocol !== "https:") return null;
        return url.href;
    } catch {
        return null;
    }
}

const routeOf = (id: string) => `${ROUTE}/${id}`;

function pageIdFor(pathname: string): string | null {
    const prefix = ROUTE + "/";
    if (!pathname.startsWith(prefix)) return null;
    return pathname.slice(prefix.length).split("/")[0] || null;
}

interface LinkIconProps {
    className?: string;
    size?: string;
    color?: string;
}

interface PrivateChannelLinkProps {
    selected: boolean;
    route: string;
    icon: (props: LinkIconProps) => ReactElement;
    text: string;
    className?: string;
    role?: "listitem";
    tabIndex?: number;
    onFocus?: () => void;
    "data-custom-page"?: string;
}

interface PrivateChannelListItem {
    role: "listitem";
    tabIndex: number;
    onFocus: () => void;
    [dataAttribute: `data-${string}`]: string;
}

const PrivateChannelLink = findComponentByCodeLazy<PrivateChannelLinkProps>(
    "nitroHoverGradient",
    "refresh_sm",
    "listItemRef"
);

const usePrivateChannelListItem: (id: string) => PrivateChannelListItem = findByCodeLazy(
    'role:"listitem"',
    "setFocus",
    "useState(-1)"
);

// The iframes live in a fixed layer on <body>, not inside the route, so leaving a
// page only hides it. Moving an iframe in the DOM reloads it, so it is never re-parented.
let keeper: HTMLDivElement | null = null;
const frames = new Map<string, { el: HTMLIFrameElement; src: string; }>();

function getKeeper() {
    if (!keeper) {
        keeper = document.createElement("div");
        keeper.className = cl("keeper");
        keeper.hidden = true;
        document.body.appendChild(keeper);
    }
    return keeper;
}

// Background frames unload on their own after `unloadAfter` minutes hidden.
const unloadTimers = new Map<string, ReturnType<typeof setTimeout>>();

function cancelUnload(id: string) {
    clearTimeout(unloadTimers.get(id));
    unloadTimers.delete(id);
}

function scheduleUnload(id: string) {
    const minutes = settings.store.unloadAfter;
    if (unloadTimers.has(id) || !(minutes > 0)) return;
    unloadTimers.set(id, setTimeout(() => {
        unloadTimers.delete(id);
        const entry = frames.get(id);
        if (entry && (entry.el.hidden || !keeper || keeper.hidden)) dropFrame(id);
    }, minutes * 60_000));
}

function showFrame(id: string, src: string, title: string) {
    let entry = frames.get(id);
    if (!entry || entry.src !== src) {
        entry?.el.remove();
        const el = document.createElement("iframe");
        el.className = cl("frame");
        el.src = src;
        entry = { el, src };
        frames.set(id, entry);
        getKeeper().appendChild(el);
    }
    entry.el.title = title;
    for (const [key, { el }] of frames) {
        el.hidden = key !== id;
        if (key === id) cancelUnload(key);
        else scheduleUnload(key);
    }
}

export function dropFrame(id: string) {
    cancelUnload(id);
    frames.get(id)?.el.remove();
    frames.delete(id);
}

// Drops every frame that is not on screen right now.
function dropHiddenFrames() {
    for (const [id, { el }] of frames)
        if (!keeper || keeper.hidden || el.hidden) dropFrame(id);
}

function destroyKeeper() {
    for (const id of [...frames.keys()]) dropFrame(id);
    keeper?.remove();
    keeper = null;
}

// Every https page and local http one is always embeddable (native.ts). Any other http address
// (e.g. another PC on your LAN) is only allowed by Discord's CSP from the next load on.
const embeddableAtLoad = new Set<string>();

function needsReload(src: string) {
    const url = new URL(src);
    if (url.protocol === "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1") return false;
    return !embeddableAtLoad.has(url.origin);
}

const PageView = ErrorBoundary.wrap(function PageView({ location }: { location?: { pathname: string; }; }) {
    const { pages } = settings.use(["pages"]);
    const id = pageIdFor(location?.pathname ?? window.location.pathname);
    const page = pages.find(p => p.id === id);
    const url = pageUrl(page?.url);
    const blocked = url !== null && needsReload(url);
    const src = blocked ? null : url;
    const title = page?.name || "Page";
    const anchorRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const anchor = anchorRef.current;
        if (!anchor || !id || src === null) return;

        const layer = getKeeper();
        let cancelled = false;
        let raf = 0;
        let last = "";

        // Follows the anchor every frame: sidebar/window changes move it without resizing it.
        const place = () => {
            const r = anchor.getBoundingClientRect();
            let { left } = r;

            // Server mode: also cover the DM column and the user panel below it.
            if (settings.store.asServer) {
                const list = anchor.parentElement?.parentElement?.querySelector("[class*='sidebarList_']");
                if (list) left = list.getBoundingClientRect().left;
            }

            const width = r.right - left;
            const next = `${r.top},${left},${width},${r.height}`;
            if (next !== last) {
                last = next;
                layer.style.top = `${r.top}px`;
                layer.style.left = `${left}px`;
                layer.style.width = `${width}px`;
                layer.style.height = `${r.height}px`;
            }
            raf = requestAnimationFrame(place);
        };

        void (async () => {
            if (Native) await Native.allowEmbed(src);
            if (cancelled) return;
            showFrame(id, src, title);
            place();
            layer.hidden = false;
            document.body.classList.toggle(ACTIVE_SERVER_CLASS, settings.store.asServer);
        })();

        return () => {
            cancelled = true;
            cancelAnimationFrame(raf);
            layer.hidden = true;
            document.body.classList.remove(ACTIVE_SERVER_CLASS);
            if (!settings.store.keepLoaded) dropFrame(id);
            else scheduleUnload(id);
        };
    }, [id, src, title]);

    return (
        <div className={cl("page")} ref={anchorRef}>
            {src === null && (
                <div className={cl("empty")}>
                    {blocked ? (
                        <>
                            <span>Discord needs one reload to allow {new URL(url!).host}.</span>
                            <button className={cl("reload")} onClick={() => window.location.reload()}>Reload Discord</button>
                        </>
                    ) : page ? "This page has no valid URL. Right-click its icon to edit it." : "This page doesn't exist anymore."}
                </div>
            )}
        </div>
    );
}, { noop: true });

// Right-click on any page icon/tab opens this plugin's settings.
function openSettings(e: ReactMouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    openPluginModal(plugins["Custom Pages"]);
}

// Discord's router doesn't re-render these items on navigation, so poll the path.
function useCurrentPageId() {
    const check = () => pageIdFor(window.location.pathname);
    const [current, setCurrent] = useState(check);

    useEffect(() => {
        const timer = setInterval(() => setCurrent(check()), 250);
        return () => clearInterval(timer);
    }, []);

    return current;
}

// Page logos (the website's own, or a custom logo URL) are fetched by the main process and kept
// as data: URLs in DataStore, mirrored in memory: they render instantly, need no CSP entry and no reload.
const ICON_STORE_PREFIX = "CustomPages_icon_";
const icons = new Map<string, string | null>();
const iconRequests = new Map<string, Promise<string | null>>();

function originOf(url: string | null) {
    if (!url) return null;
    try {
        return new URL(url).origin;
    } catch {
        return null;
    }
}

// Skips half-typed hosts ("https://ex") so the editor doesn't fetch on every keystroke.
function looksComplete(url: string | null) {
    if (!url) return false;
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname.includes(".");
}

// key: "site:<origin>" or "custom:<logo url>".
function iconKey(page: Page) {
    const custom = pageUrl(page.icon);
    if (custom) return looksComplete(custom) ? `custom:${custom}` : null;
    if (!looksComplete(pageUrl(page.url))) return null;
    const origin = originOf(pageUrl(page.url));
    return origin ? `site:${origin}` : null;
}

function loadIcon(key: string) {
    let request = iconRequests.get(key);
    if (!request) {
        request = (async () => {
            const stored = await DataStore.get<string>(ICON_STORE_PREFIX + key);
            if (stored) return stored;
            const target = key.slice(key.indexOf(":") + 1);
            const fetched = !Native ? null
                : key.startsWith("custom:") ? await Native.fetchImage(target) : await Native.fetchSiteIcon(target);
            // Failures are only remembered for this session, so the next start retries.
            if (fetched) await DataStore.set(ICON_STORE_PREFIX + key, fetched);
            return fetched;
        })().then(icon => {
            icons.set(key, icon);
            iconRequests.delete(key);
            return icon;
        });
        iconRequests.set(key, request);
    }
    return request;
}

function usePageIcon(page: Page) {
    const key = iconKey(page);
    const [icon, setIcon] = useState(() => (key && icons.get(key)) || null);

    useEffect(() => {
        if (!key) return setIcon(null);
        if (icons.has(key)) return setIcon(icons.get(key) ?? null);
        let live = true;
        void loadIcon(key).then(found => live && setIcon(found));
        return () => { live = false; };
    }, [key]);

    return icon;
}

export function PageLogo({ page, className }: { page: Page; className?: string; }) {
    const src = usePageIcon(page);
    // A logo that fails to load (blocked, 404) falls back to the letter.
    const [failed, setFailed] = useState<string | null>(null);

    if (src && failed !== src) {
        return (
            <img
                alt=""
                aria-hidden="true"
                className={classes(className, cl("icon"))}
                draggable={false}
                onError={() => setFailed(src)}
                src={src}
            />
        );
    }
    return (
        <span aria-hidden="true" className={classes(className, cl("icon"), cl("letter"))}>
            {(page.name.trim()[0] ?? "?").toUpperCase()}
        </span>
    );
}

function PageTab({ page, selected }: { page: Page; selected: boolean; }) {
    const listItem = usePrivateChannelListItem(`custom-page-${page.id}`);

    return (
        <div className={cl("contents")} onContextMenu={openSettings}>
            <PrivateChannelLink
                {...listItem}
                data-custom-page={page.id}
                icon={({ className }) => <PageLogo page={page} className={className} />}
                route={routeOf(page.id)}
                selected={selected}
                text={page.name || "Page"}
            />
        </div>
    );
}

const PageTabs = ErrorBoundary.wrap(function PageTabs() {
    const current = useCurrentPageId();
    const { asServer, pages } = settings.use(["asServer", "pages"]);

    if (asServer) return null;
    return <>{pages.map(page => <PageTab key={page.id} page={page} selected={current === page.id} />)}</>;
}, { noop: true });

const PageServerIcons = ErrorBoundary.wrap(function PageServerIcons() {
    const current = useCurrentPageId();
    const { asServer, pages } = settings.use(["asServer", "pages"]);

    if (!asServer) return null;

    return (
        <>
            {pages.map(page => (
                <div key={page.id} className={classes(cl("server"), current === page.id && cl("server-selected"))}>
                    <span className={cl("server-pill")} />
                    <Tooltip text={page.name || "Page"} position="right">
                        {tooltipProps => (
                            <button
                                {...tooltipProps}
                                aria-label={page.name || "Page"}
                                className={cl("server-icon")}
                                onClick={() => NavigationRouter.transitionTo(routeOf(page.id))}
                                onContextMenu={openSettings}
                            >
                                <PageLogo page={page} />
                            </button>
                        )}
                    </Tooltip>
                </div>
            ))}
        </>
    );
}, { noop: true });

let serverListTimer: ReturnType<typeof setTimeout> | undefined;

export default definePlugin({
    name: "Custom Pages",
    description: "Add your own web pages to Discord, as home sidebar tabs or as server icons.",
    authors: [
        { name: "xMimiez", id: 0n },
        { name: "BunnyHoper", id: 0n }
    ],
    dependencies: ["ServerListAPI"],
    settings,

    start() {
        for (const page of settings.store.pages) {
            const src = pageUrl(page.url);
            if (src === null) continue;
            embeddableAtLoad.add(new URL(src).origin);
            if (Native) void Native.allowEmbed(src);
        }
        // Deferred so items other plugins add while starting (e.g. Nighty Tab) stay above ours.
        serverListTimer = setTimeout(() => addServerListElement(ServerListRenderPosition.Above, PageServerIcons));
    },

    stop() {
        clearTimeout(serverListTimer);
        removeServerListElement(ServerListRenderPosition.Above, PageServerIcons);
        destroyKeeper();
    },

    patches: [
        {
            find: '"section-divider-top"',
            replacement: {
                match: /\(0,\i\.jsx\)\(\i,\{\},"section-divider-top"\)/,
                replace: "$self.renderTabs(),$&"
            }
        },
        {
            find: ".QUEST_HOME,render:",
            replacement: {
                match: /\(0,(\i)\.jsx\)\((\i\.\i),\{path:\i\.\i\.QUEST_HOME,render:\i,impressionName:\i\.ImpressionNames\.QUEST_HOME,disableTrack:!0\}\)/,
                replace: '$&,(0,$1.jsx)($2,{path:"/custom-pages",render:$self.renderPage})'
            }
        },
        {
            find: "isChatRoute:!0",
            replacement: {
                match: /(\i\.\i\.FAMILY_CENTER\]),render:(\i),isChatRoute:!0\}/,
                replace: '$1,render:$2,isChatRoute:!0},{path:["/custom-pages"],render:$2}'
            }
        }
    ],

    renderTabs() {
        return <PageTabs />;
    },

    renderPage(props: { location?: { pathname: string; }; }) {
        return <PageView location={props?.location} />;
    }
});
