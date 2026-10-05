/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The two pages that come with the plugin: the author's GitHub. They show up the first time the plugin runs (while the page
// list has never been edited); after that the list in the plugin settings is yours — edit, remove or add pages freely.
export const DEFAULT_PAGES = [
    {
        id: "github",
        name: "GitHub",
        url: "https://github.com/BunnyHoper",
        icon: "https://github.githubassets.com/favicons/favicon.png"
    },
    {
        id: "github-repos",
        name: "Repositories",
        url: "https://github.com/BunnyHoper?tab=repositories",
        icon: "https://github.githubassets.com/favicons/favicon.png"
    }
];
