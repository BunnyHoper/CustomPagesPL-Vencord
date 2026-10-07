/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, BrowserWindow, IpcMainInvokeEvent, net, session, shell, WebContentsView } from "electron";

// ── Pages as real Chromium views ──────────────────────────────────────────────────────────────
// Each page is its own WebContentsView attached to Discord's window: its own renderer process and
// a persistent session shared by all pages, like a separate browser tab. Nothing is embedded in
// Discord's document, so there's no CSP / X-Frame-Options / third-party-cookie trouble and
// logins (Google, Cloudflare, …) work as in a normal browser.

const PARTITION = "persist:vc-custom-pages";
const ALLOWED_PERMISSIONS = new Set(["clipboard-read", "clipboard-sanitized-write", "notifications", "fullscreen"]);

interface PageView { view: WebContentsView; url: string; host: BrowserWindow; }
const views = new Map<string, PageView>();

export interface Rect { x: number; y: number; w: number; h: number; }

const KEY = /^[\w-]{1,40}$/;

function httpUrl(url: string) {
    try {
        const parsed = new URL(url);
        return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
    } catch {
        return null;
    }
}

let sessionReady = false;
function pageSession() {
    const ses = session.fromPartition(PARTITION);
    if (!sessionReady) {
        sessionReady = true;
        // Plain Chrome user agent: some logins (Google) refuse anything that says Electron/discord.
        ses.setUserAgent(ses.getUserAgent().replace(/\s(?:Electron|discord)\/\S+/gi, ""));
        ses.setPermissionRequestHandler((_wc, permission, done) => done(ALLOWED_PERMISSIONS.has(permission)));
        ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
    }
    return ses;
}

// "accounts.google.com" → "google.com", "a.b.co.uk" → "b.co.uk".
function siteOf(hostname: string) {
    const labels = hostname.toLowerCase().split(".");
    if (labels.length <= 2 || /^[\d.]+$/.test(hostname)) return hostname.toLowerCase();
    const [second, top] = labels.slice(-2);
    return labels.slice(top.length === 2 && /^(co|com|org|net|gov|edu|ac)$/.test(second) ? -3 : -2).join(".");
}

function createView(host: BrowserWindow, url: string) {
    const view = new WebContentsView({
        webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false }
    });
    pageSession();
    view.setBackgroundColor("#00000000");

    // Popups: logins and same-site windows open as small app windows on the same session
    // (so the login lands in the page); anything else opens in the normal browser.
    view.webContents.setWindowOpenHandler(({ url: target, features }) => {
        const parsed = httpUrl(target);
        if (!parsed) return { action: "deny" };
        const pageSite = siteOf(new URL(url).hostname);
        const isPopup = /\b(width|height)=/.test(features);
        if (isPopup || siteOf(parsed.hostname) === pageSite) {
            return {
                action: "allow",
                overrideBrowserWindowOptions: {
                    parent: host, autoHideMenuBar: true, width: 520, height: 700,
                    webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false }
                }
            };
        }
        void shell.openExternal(parsed.href);
        return { action: "deny" };
    });

    host.contentView.addChildView(view);
    void view.webContents.loadURL(url);
    return view;
}

function destroy(id: string) {
    const entry = views.get(id);
    if (!entry) return;
    views.delete(id);
    try {
        if (!entry.host.isDestroyed()) entry.host.contentView.removeChildView(entry.view);
        if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close();
    } catch { /* window already gone */ }
}

// Renderer sends CSS pixels; views are positioned in the window's DIPs (CSS px × Discord's zoom).
function toBounds(event: IpcMainInvokeEvent, rect: Rect) {
    const zoom = event.sender.getZoomFactor();
    return {
        x: Math.round(rect.x * zoom), y: Math.round(rect.y * zoom),
        width: Math.max(1, Math.round(rect.w * zoom)), height: Math.max(1, Math.round(rect.h * zoom))
    };
}

// Shows page `id` at `rect` (creating it, or reloading it if its URL changed) and hides the others.
export function showPage(event: IpcMainInvokeEvent, id: string, url: string, rect: Rect) {
    const host = BrowserWindow.fromWebContents(event.sender);
    if (!host || !KEY.test(id) || !httpUrl(url)) return;

    let entry = views.get(id);
    if (entry && (entry.url !== url || entry.host !== host || entry.view.webContents.isDestroyed())) {
        destroy(id);
        entry = undefined;
    }
    if (!entry) {
        entry = { view: createView(host, url), url, host };
        views.set(id, entry);
        entry.view.webContents.on("destroyed", () => {
            if (views.get(id)?.view === entry!.view) views.delete(id);
        });
    }

    entry.view.setBounds(toBounds(event, rect));
    for (const [key, other] of views) other.view.setVisible(key === id);
}

export function setBounds(event: IpcMainInvokeEvent, id: string, rect: Rect) {
    views.get(id)?.view.setBounds(toBounds(event, rect));
}

// Hidden while a Discord modal/menu is open (native views paint above Discord's UI) or when you leave the page.
export function setVisible(_event: IpcMainInvokeEvent, id: string, visible: boolean) {
    views.get(id)?.view.setVisible(visible);
}

export function destroyPage(_event: IpcMainInvokeEvent, id: string) {
    destroy(id);
}

export function destroyAll() {
    for (const id of [...views.keys()]) destroy(id);
}

export function isLoaded(_event: IpcMainInvokeEvent, id: string) {
    return views.has(id);
}

// ── /custom-pages reload redirect ─────────────────────────────────────────────────────────────
// The route only exists client-side. When Discord reloads or restarts on it, the server answers
// with a 404 page instead of the app, so send that load to /app instead. Electron keeps one
// onBeforeRequest listener per session and discord_desktop_core installs its own later, so the
// setter is wrapped to always merge ours in; other plugins doing the same chain on top.
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

// ── Logos ─────────────────────────────────────────────────────────────────────────────────────
// Website logo for pages without a custom one (and custom logo URLs), fetched here and handed
// back as a data: URL, which the renderer caches.
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

export async function fetchImage(_event: IpcMainInvokeEvent, url: string): Promise<string | null> {
    return httpUrl(url) ? imageAsDataUrl(url) : null;
}

export async function fetchSiteIcon(_event: IpcMainInvokeEvent, pageUrl: string): Promise<string | null> {
    const parsed = httpUrl(pageUrl);
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
