/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addResponseHeaderHook, CspPolicies } from "@main/csp";
import { RendererSettings } from "@main/settings";
import { app, IpcMainInvokeEvent, session } from "electron";

const MONTH_SECONDS = 60 * 60 * 24 * 30;
const embedHosts = new Set<string>();
let headerHooked = false;

// Discord's CSP only allows frames/images from known hosts. It is applied to the
// main frame when it loads, so a new URL needs one Ctrl+R after it is set.
function allowDirective(source: string, directive: string) {
    const directives = CspPolicies[source] ?? [];
    if (!directives.includes(directive)) CspPolicies[source] = [...directives, directive];
}

// /custom-pages only exists client-side. When Discord reloads or restarts on it, the server
// answers with a 404 page instead of the app, so send that load to /app instead.
// Electron keeps one onBeforeRequest listener per session and discord_desktop_core installs
// its own later, so wrap the setter to always merge ours with whatever it sets. Other plugins
// using this same wrapper chain on top of each other, whatever the load order.
const ROUTE_PATTERNS = ["*://discord.com/custom-pages*", "*://*.discord.com/custom-pages*"];
const ROUTE_URL = /^https?:\/\/([\w-]+\.)?discord\.com\/custom-pages(?:[/?#]|$)/;

type BeforeRequestListener = (details: Electron.OnBeforeRequestListenerDetails, cb: (response: Electron.CallbackResponse) => void) => void;

void app.whenReady().then(() => {
    const { webRequest } = session.defaultSession;
    const setListener = webRequest.onBeforeRequest.bind(webRequest) as (filter: Electron.WebRequestFilter, listener: BeforeRequestListener) => void;

    const install = (filter: Electron.WebRequestFilter | null, other: BeforeRequestListener | null) => {
        setListener({ ...filter, urls: [...(filter?.urls ?? []), ...ROUTE_PATTERNS] }, (details, cb) => {
            if (ROUTE_URL.test(details.url)) cb({ redirectURL: new URL("/app", details.url).href });
            else if (other) other(details, cb);
            else cb({});
        });
    };

    webRequest.onBeforeRequest = ((filterOrListener: any, maybeListener?: any) => {
        if (typeof filterOrListener === "function") install(null, filterOrListener);
        else install(filterOrListener, maybeListener ?? null);
    }) as typeof webRequest.onBeforeRequest;

    install(null, null);
});

function hostOf(url: string) {
    try {
        return new URL(url).host;
    } catch {
        return "";
    }
}

function keepEmbedCookie(cookie: string) {
    let next = cookie.replace(/;\s*samesite=[^;]*/gi, "").replace(/;\s*partitioned\b/gi, "");
    if (!/;\s*secure\b/i.test(next)) next += "; Secure";
    next += "; SameSite=None; Partitioned";
    if (!/(?:^|;)\s*(?:expires|max-age)=/i.test(next)) next += `; Max-Age=${MONTH_SECONDS}`;
    return next;
}

function allowEmbedDocument(headers: Record<string, string[]>) {
    for (const name of Object.keys(headers)) {
        const lower = name.toLowerCase();
        if (lower === "x-frame-options" || lower === "cross-origin-opener-policy" || lower === "cross-origin-resource-policy") {
            delete headers[name];
            continue;
        }
        if (lower !== "content-security-policy") continue;
        headers[name] = headers[name]
            .map(policy => policy
                .split(";")
                .map(part => part.trim())
                .filter(part => part !== "" && !/^frame-ancestors\b/i.test(part))
                .join("; "))
            .filter(policy => policy !== "");
    }
}

function hookHeaders() {
    if (headerHooked) return;
    headerHooked = true;

    addResponseHeaderHook(({ url, responseHeaders }) => {
        if (!embedHosts.has(hostOf(url))) return;

        allowEmbedDocument(responseHeaders);
        const key = Object.keys(responseHeaders).find(name => name.toLowerCase() === "set-cookie");
        const cookies = key === undefined ? undefined : responseHeaders[key];
        if (key !== undefined && cookies)
            responseHeaders[key] = cookies.map(keepEmbedCookie);
    });
}

function permitImage(url: string) {
    try {
        allowDirective(new URL(url).origin, "img-src");
    } catch { /* invalid URL */ }
}

function permitEmbed(url: string) {
    const host = hostOf(url);
    if (host === "") return;
    embedHosts.add(host);
    allowDirective(new URL(url).origin, "frame-src");
    hookHeaders();
}

export function allowImage(_event: IpcMainInvokeEvent, url: string) {
    permitImage(url);
}

export function allowEmbed(_event: IpcMainInvokeEvent, url: string) {
    permitEmbed(url);
}

interface SavedPage {
    url?: string;
    icon?: string;
}

function permitPages(pages: SavedPage[] | undefined) {
    for (const page of pages ?? []) {
        if (page.url) permitEmbed(page.url);
        if (page.icon) permitImage(page.icon);
    }
}

// Apply the saved pages before the main frame loads: no extra Ctrl+R after a Discord restart.
permitPages(RendererSettings.store.plugins?.["Custom Pages"]?.pages);
RendererSettings.addChangeListener("plugins.Custom Pages.pages", (pages: SavedPage[]) => permitPages(pages));
