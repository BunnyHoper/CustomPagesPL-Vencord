/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addResponseHeaderHook, CspPolicies } from "@main/csp";
import { RendererSettings } from "@main/settings";
import { app, IpcMainInvokeEvent, net, session } from "electron";

import { DEFAULT_PAGES } from "./defaults";

const MONTH_SECONDS = 60 * 60 * 24 * 30;
// Sites (registrable domains) of your pages. Unlocking is per site, not per exact host, because
// pages often redirect within their site (youtube.com → www.youtube.com, open.spotify.com → accounts.spotify.com).
const embedSites = new Set<string>();
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

// "www.youtube.com:443" → "youtube.com", "a.b.co.uk" → "b.co.uk"; IPs and localhost stay as they are.
function siteOf(host: string) {
    const name = host.replace(/:\d+$/, "").toLowerCase();
    if (name === "localhost" || /^[\d.]+$/.test(name)) return name;
    const labels = name.split(".");
    if (labels.length <= 2) return name;
    const [second, top] = labels.slice(-2);
    const keep = top.length === 2 && /^(co|com|org|net|gov|edu|ac)$/.test(second) ? 3 : 2;
    return labels.slice(-keep).join(".");
}

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
        if (!embedSites.has(siteOf(hostOf(url)))) return;

        allowEmbedDocument(responseHeaders);
        const key = Object.keys(responseHeaders).find(name => name.toLowerCase() === "set-cookie");
        const cookies = key === undefined ? undefined : responseHeaders[key];
        if (key !== undefined && cookies)
            responseHeaders[key] = cookies.map(keepEmbedCookie);
    });
}

// Only well-formed http(s) origins ever reach the CSP: a stray character like "," would
// split Discord's CSP header into two policies and block every embedded page.
const SAFE_HOST = /^(?:[a-z0-9-]+\.)*[a-z0-9-]+(?::\d{1,5})?$/i;

function safeOrigin(url: string) {
    try {
        const parsed = new URL(url);
        if ((parsed.protocol === "http:" || parsed.protocol === "https:") && SAFE_HOST.test(parsed.host))
            return parsed;
    } catch { /* invalid URL */ }
    return null;
}

function permitImage(url: string) {
    const parsed = safeOrigin(url);
    if (parsed) allowDirective(parsed.origin, "img-src");
}

function permitEmbed(url: string) {
    const parsed = safeOrigin(url);
    if (!parsed) return;
    embedSites.add(siteOf(parsed.host));
    allowDirective(parsed.origin, "frame-src");
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
// Never edited yet → the two default GitHub pages (defaults.ts), which the renderer shows as well.
// No settings change listener on purpose: it fires on every keystroke while a URL is typed.
// New/edited pages are allowed when opened (allowEmbed) and need one Ctrl+R.
permitPages(RendererSettings.store.plugins?.["Custom Pages"]?.pages ?? DEFAULT_PAGES);

// Any https page (plus local http) can be framed without a reload, so switching a page to
// another website just works. Header unlocking (X-Frame-Options, frame-ancestors) still only
// applies to hosts of your pages, and is added live when a page opens.
for (const source of ["https:", "http://localhost:*", "http://127.0.0.1:*"])
    allowDirective(source, "frame-src");

// Website logo for pages without a custom one. Fetched here (no CSP in the main process)
// and handed back as a data: URL, which the renderer caches.
const MAX_ICON_BYTES = 512 * 1024;

async function fetchWithTimeout(url: string, ms = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
        return await net.fetch(url, { signal: controller.signal, redirect: "follow" });
    } finally {
        clearTimeout(timer);
    }
}

async function imageAsDataUrl(url: string) {
    try {
        const res = await fetchWithTimeout(url);
        const type = res.headers.get("content-type")?.split(";")[0].trim() ?? "";
        if (!res.ok || !type.startsWith("image/")) return null;
        const bytes = Buffer.from(await res.arrayBuffer());
        if (bytes.length === 0 || bytes.length > MAX_ICON_BYTES) return null;
        return `data:${type};base64,${bytes.toString("base64")}`;
    } catch {
        return null;
    }
}

// <link rel="icon|shortcut icon|apple-touch-icon" href="..." sizes="..."> → candidates, biggest first.
function iconLinks(html: string, base: string) {
    const found: { href: string; size: number; }[] = [];
    for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
        const rel = tag.match(/\brel\s*=\s*["']([^"']+)["']/i)?.[1].toLowerCase() ?? "";
        if (!/\b(icon|apple-touch-icon)\b/.test(rel) || rel.includes("mask-icon")) continue;
        const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
        if (!href) continue;
        const size = Number(tag.match(/\bsizes\s*=\s*["'](\d+)x\d+/i)?.[1] ?? (rel.includes("apple") ? 180 : 32));
        try {
            found.push({ href: new URL(href, base).href, size });
        } catch { /* bad href */ }
    }
    return found.sort((a, b) => b.size - a.size).map(icon => icon.href);
}

// Custom logo URLs go through here too: no img-src CSP entry, no reload, cached like site logos.
export async function fetchImage(_event: IpcMainInvokeEvent, url: string): Promise<string | null> {
    return safeOrigin(url) ? imageAsDataUrl(url) : null;
}

export async function fetchSiteIcon(_event: IpcMainInvokeEvent, pageUrl: string): Promise<string | null> {
    const parsed = safeOrigin(pageUrl);
    if (!parsed) return null;

    const candidates: string[] = [];
    try {
        const res = await fetchWithTimeout(parsed.href);
        if (res.ok && (res.headers.get("content-type") ?? "").includes("html"))
            candidates.push(...iconLinks((await res.text()).slice(0, 300_000), res.url || parsed.href));
    } catch { /* site unreachable: fall back below */ }
    candidates.push(`${parsed.origin}/favicon.ico`);

    for (const url of candidates) {
        const data = await imageAsDataUrl(url);
        if (data) return data;
    }
    return null;
}
