# CLAUDE.md — Project Root

This file enables Claude to fully understand and recreate this project from scratch.

---

## Project Identity

- **Name:** SVTC Hello World
- **Package name:** `svtc-hello-world`
- **Version:** `0.0.1`
- **Live URL:** https://svtc.up.railway.app/
- **GitHub:** https://github.com/pyenthu/SVTC

---

## Tech Stack

| Tool | Version | Role |
|------|---------|------|
| SvelteKit | ^2.0.0 | Full-stack framework |
| Svelte | ^5.0.0 | UI component language |
| Vite | ^6.0.0 | Build tool |
| Flowbite Svelte | ^1.31.0 | UI component library (Drawer, CloseButton) |
| Flowbite Svelte Icons | ^3.1.0 | Icon set (BarsOutline) |
| Flowbite | ^4.0.1 | Flowbite base theme |
| Tailwind CSS v4 | ^4.2.2 | Utility-first CSS |
| @tailwindcss/vite | ^4.2.2 | Tailwind Vite plugin |
| @sveltejs/adapter-node | ^5.0.0 | Node.js SSR adapter |
| Bun | 1.x | Package manager and runtime |
| Docker | — | Multi-stage containerised builds |
| Railway | — | Hosting, auto-deploys on git push |

---

## Key Design Decisions

1. **`"type": "module"` in package.json** — required because `@sveltejs/kit` is ESM-only. Without it, `vite.config.js` fails to load via `require()`.
2. **Bun instead of npm** — faster installs and builds. Use `bun install`, `bun run build`, etc.
3. **Tailwind CSS v4 with `@tailwindcss/vite`** — imported via `vite.config.js` plugin, not a PostCSS config. No `tailwind.config.js` needed.
4. **Flowbite Drawer API** — uses `open` prop (not deprecated `hidden`). Must set `dismissable={false}` to suppress the built-in close button; use `outsideclose={true}` to close on backdrop click.
5. **Multi-stage Dockerfile** — Stage 1 builds with all devDeps; Stage 2 is lean with only `build/` and prod deps.
6. **Railway uses Dockerfile** — `railway.toml` sets `builder = "DOCKERFILE"`. Every push to `main` triggers auto-redeploy.

---

## Branch Strategy

| Branch | Purpose |
|--------|---------|
| `merge-to-main` | Active development branch — tracked as `main` on GitHub, auto-deploys to Railway |
| `master` | Stable mirror — periodically merged from `merge-to-main` |

**Workflow:**
```bash
# develop on merge-to-main
git checkout merge-to-main
# ... make changes ...
git push -u github merge-to-main:main   # deploys to Railway

# sync master
git checkout master
git merge merge-to-main
git push -u github master
git checkout merge-to-main
```

---

## Commands

```bash
bun install          # install dependencies
bun run dev          # start dev server (http://localhost:5173)
bun run build        # production build → ./build
node build           # run production server on port 3000
```

---

## File Structure

```
/
├── CLAUDE.md                        # ← you are here
├── Dockerfile                       # multi-stage bun build
├── .dockerignore                    # excludes node_modules, .svelte-kit, build, package-lock.json
├── railway.toml                     # Railway: builder=DOCKERFILE
├── package.json                     # type=module, bun scripts
├── bun.lock                         # bun lockfile
├── svelte.config.js                 # adapter-node
├── vite.config.js                   # tailwindcss() + sveltekit() plugins
└── src/
    ├── CLAUDE.md                    # src-level guide
    ├── app.css                      # Tailwind + Flowbite CSS entry
    ├── app.html                     # HTML shell
    ├── routes/
    │   ├── CLAUDE.md                # routes guide
    │   ├── +layout.svelte           # imports app.css globally
    │   └── +page.svelte             # Hello World page with Sidebar
    └── lib/
        └── components/
            └── Sidebar/
                ├── CLAUDE.md        # Sidebar component guide
                ├── Sidebar.svelte   # Flowbite Drawer-based sidebar
                └── index.js         # barrel export
```

---

## Recreating From Scratch

```bash
# 1. Create SvelteKit project
bunx create-svelte@latest my-app
cd my-app

# 2. Add type=module to package.json
# (edit package.json: add "type": "module")

# 3. Install UI dependencies
bun add flowbite-svelte flowbite flowbite-svelte-icons
bun add -d tailwindcss @tailwindcss/vite

# 4. Configure Vite (vite.config.js)
# import tailwindcss from '@tailwindcss/vite'
# plugins: [tailwindcss(), sveltekit()]

# 5. Create src/app.css
# @import 'tailwindcss';
# @import 'flowbite/src/themes/default';
# @source '../node_modules/flowbite-svelte/dist';

# 6. Create src/routes/+layout.svelte
# <script>import '../app.css';</script><slot />

# 7. Build Sidebar component → see src/lib/components/Sidebar/CLAUDE.md

# 8. Build main page → see src/routes/CLAUDE.md

# 9. Build and verify
bun run build && node build
curl http://localhost:3000/
```
