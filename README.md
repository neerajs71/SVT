# SVTC - SvelteKit Hello World

A SvelteKit Hello World app deployed on Railway with a collapsible sidebar, Flowbite Svelte UI, and Tailwind CSS.

## Live Deployment

Production URL: https://svtc.up.railway.app/

---

## Tech Stack

| Tool | Purpose |
|------|---------|
| [SvelteKit](https://kit.svelte.dev/) | Full-stack web framework |
| [Flowbite Svelte](https://flowbite-svelte.com/) | UI component library |
| [Tailwind CSS v4](https://tailwindcss.com/) | Utility-first CSS |
| [Bun](https://bun.sh/) | Fast package manager & runtime |
| [Docker](https://www.docker.com/) | Containerised builds |
| [Railway](https://railway.app/) | Hosting & auto-deployments |

---

## Features

- **Hello World page** with dark green heading (`#006400`)
- **Collapsible sidebar** (Flowbite `Drawer` component)
  - Extra-small hamburger button flush to the left edge
  - Toggles open/close on click
  - Single X close button in the **ACTIVE SIDEBAR** header
  - Click outside to close
  - Nav links: Home, About, Services, Contact
- **Modular component structure** — sidebar lives in `src/lib/components/Sidebar/`

---

## Project Structure

```
src/
├── app.css                          # Tailwind + Flowbite theme imports
├── app.html                         # HTML shell
├── routes/
│   ├── +layout.svelte               # Global CSS loader
│   └── +page.svelte                 # Main page
└── lib/
    └── components/
        └── Sidebar/
            ├── Sidebar.svelte       # Drawer-based sidebar component
            └── index.js             # Barrel export
```

---

## Development

```bash
bun install
bun run dev
```

## Build

```bash
bun run build
node build        # starts on port 3000
```

---

## Docker

Multi-stage build for lean production images:

```bash
docker build -t svtc .
docker run -p 3000:3000 svtc
```

**Stage 1 (builder):** installs all deps + compiles the app
**Stage 2 (final):** copies only `build/` + prod dependencies

---

## Deploy on Railway

Railway is configured via `railway.toml` to use the `Dockerfile`:

```toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "Dockerfile"
```

Every push to `main` triggers an automatic redeploy on Railway.

---

## Branches

| Branch | Purpose |
|--------|---------|
| `main` (`merge-to-main`) | Primary development branch, auto-deploys to Railway |
| `master` | Stable mirror of main |
