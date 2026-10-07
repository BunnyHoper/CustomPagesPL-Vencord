# 🧩 ᴄᴜѕᴛᴏᴍᴘᴀɢᴇѕᴘʟ-ᴠᴇɴᴄᴏʀᴅ
[![GitHub repo](https://img.shields.io/badge/github-BunnyHoper-blue?style=for-the-badge&logo=github)](https://github.com/BunnyHoper)
[![Client Mod](https://img.shields.io/badge/Client%20Mod-Vencord-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://github.com/Vendicated/Vencord)
[![Version](https://img.shields.io/badge/ver-1.0.0-red?style=for-the-badge)](https://github.com/BunnyHoper/CustomPagesPL-Vencord)
[![Donate](https://img.shields.io/badge/Support%20Me-paypal.me/AritzGonzalez7-yellowgreen?style=for-the-badge&logo=paypal)](https://paypal.me/AritzGonzalez7)

> **Any website, inside Discord (no extra window).** Add as many pages as you want — each with its own name, URL and logo — as home sidebar tabs or as server icons that open full width.

---

## ✨ ɪɴᴛʀᴏᴅᴜᴄᴛɪᴏɴ

Stop alt-tabbing between Discord and your dashboards (it's a waste of time). **Custom Pages** is a standalone Vencord plugin that embeds your own web pages straight into Discord: a bot panel, a self-hosted dashboard, a status page, a search engine — anything with an `http`/`https` URL.

---

## 🛠️ ᴄᴏʀᴇ ᴄᴀᴘᴀʙɪʟɪᴛɪᴇѕ

*   **Unlimited Pages:** Add, edit, reorder and delete pages from the plugin settings. Each page has a name, a URL and a logo.
*   **Two Layouts:** Home sidebar tabs under Quests, or **server icons** at the top of the server list that open full width, like a whole server.
*   **Automatic Logos:** Each page uses the website's own logo, downloaded once and cached — no logo URL needed. Want another one? Set a custom logo URL. Nothing found → the first letter of the page name.
*   **Stays Loaded:** Leave a page and it keeps running in the background — come back and it's exactly where you left it. After **5 minutes** unused it unloads on its own to free memory (configurable).
*   **Right-Click → Settings:** Right-click any page icon or tab to jump straight into the editor.
*   **Real Chromium Views:** Each page runs in its own Chromium view (Electron `WebContentsView`, like a separate browser tab) laid over Discord — not an iframe. No embed blocking, logins work (Google, Cloudflare, …) and stay saved, and a heavy page can't slow Discord's own UI.
*   **Popups Handled:** Login popups open in a small window on the same session; links to other websites open in your browser.
*   **Restart-Safe:** Restarting or reloading Discord while on a page sends you back to the app instead of Discord's 404 page.
*   **Plays Nice:** Works next to other plugins that add tabs or server icons, like [Nighty Tab](https://github.com/BunnyHoper/Nighty-Tab-Plugin) — its icon/tab stays above your pages.

---

## 📂 ᴀʀᴄʜɪᴛᴇᴄᴛᴜʀᴇ -- ʀᴏᴏᴛ

| Folder/File | Type | Action |
| :--- | :---: | :--- |
| `index.tsx` | **Core** | The plugin: settings, tabs, server icons, `/custom-pages/<id>` pages. |
| `PagesEditor.tsx` | **UI** | The page list editor shown in the plugin settings. |
| `defaults.ts` | **Data** | The two pages that come with the plugin (the author's GitHub), shown until you edit the list. |
| `native.ts` | **Native** | Main-process side: one Chromium view per page, popups, logos, restart redirect. |
| `style.css` | **Style** | Server icons, page area and the editor. |

---

## ⚙️ ǫᴜɪᴄᴋ ѕᴛᴀʀᴛ ɢᴜɪᴅᴇ

1.  **Get a Vencord build from source** (needs [Git](https://git-scm.com), [Node.js](https://nodejs.org) and [pnpm](https://pnpm.io)):
    ```bash
    git clone https://github.com/Vendicated/Vencord
    cd Vencord
    pnpm install --frozen-lockfile
    ```

2.  **Add the plugin:** Copy `index.tsx`, `PagesEditor.tsx`, `defaults.ts`, `native.ts` and `style.css` into `src/userplugins/customPages/`. No Vencord patch needed.

3.  **Build & inject:**
    ```bash
    pnpm build
    pnpm inject
    ```

4.  **Fully restart Discord:** System tray → right-click Discord → **Quit Discord**, then open it again.

5.  **Add your pages:** Settings → Vencord → Plugins → **Custom Pages** → **Add page**, fill in a name and URL (the logo is picked up from the website).

---

## 🔧 ѕᴇᴛᴛɪɴɢѕ

| Setting | Default | Action |
| :--- | :---: | :--- |
| `Pages` | — | Your pages: name, URL and an optional custom logo (blank = the website's own). Reorder with ▲ ▼, delete with the bin. Changes apply right away. |
| `Show as servers` | `off` | One server icon per page at the top of the server list + full-width pages. Off = home sidebar tabs. |
| `Keep loaded in background` | `on` | Keeps pages alive when you leave them. Off = they unload and reload on every visit. |
| `Unload after (minutes)` | `5` | How long an unused page stays loaded in the background before it unloads. `0` = never. |

---

## 🩺 ᴛʀᴏᴜʙʟᴇѕʜᴏᴏᴛɪɴɢ

| Symptom | Fix |
| :--- | :--- |
| Still empty | Open the URL in a browser — if it doesn't load there, it won't load here either. |
| Logo shows a letter | The site has no usable logo (e.g. a login page without favicon) — set a custom logo URL for that page. |
| Nothing shows after install | Discord wasn't fully restarted. Quit it from the tray and reopen. |
| Can't close Discord to restart | Discord is running as administrator — close it from the tray or Task Manager. |

---

## 💖 ᴄʀᴇᴅɪᴛѕ

<a href="https://github.com/xMimiez"><img src="assets/xmimiez.jpg" width="96" height="96" alt="xMimiez" /></a>

Huge thanks to **[xMimiez](https://github.com/xMimiez)** (Mime | N0_.q3) — this plugin is built on top of their original **Nighty Tab** plugin for Vencord. 🙏

---

## 🤝 ᴄᴏɴᴛʀɪʙᴜᴛɪᴏɴ ᴀɴᴅ ѕᴜᴘᴘᴏʀᴛ

Contributions are welcome. If a page won't embed or a Discord update breaks a tab/icon:

1.  Fork the repository.
2.  Create a feature branch.
3.  Commit your improvements.
4.  Open a **Pull Request**.

---

## 📜 ʟɪᴄᴇɴѕᴇ

MIT — see [`LICENSE`](LICENSE). Feel free to do any u want with my scripts. God bless.

***
*Built with ❤️ by Bunny.*
