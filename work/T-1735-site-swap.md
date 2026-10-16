---
id: T-1735
title: "New landing, step 8: swap apps/site-next into apps/site (package @zilar/site, Next static export), drop the old Vite site, and update the Dockerfile and Caddyfile (out/ instead of dist/, /_next/static cached) keeping every redirect"
status: merged
milestone: M5
branch: task/T-1735-site-swap
model: auto
effort: default
depends_on: [T-1729, T-1730, T-1731, T-1732, T-1733, T-1734]
estimate: 35 min
---

# T-1735: Swap the new landing in

## Spec (written by Claude, do not edit)

### Why
The new landing was built in `apps/site-next` (T-1728 to T-1734) so the live site kept working. The Coolify `landing` Application builds `apps/site/Dockerfile` on every push to main. This task moves the new site into `apps/site` in one merge.

### Facts (the lead read them on 2026-10-16)
- **`apps/site/Dockerfile`:**
  - builds from the repo root: it copies the manifests and `apps/site/package.json`, runs `pnpm install --frozen-lockfile --filter @zilar/site...`, copies `apps/site`, then runs `pnpm --filter @zilar/site build`;
  - the runtime is `caddy:2.10.2-alpine`, copying `apps/site/Caddyfile` and `/repo/apps/site/dist` to `/srv/zilar-site`;
  - a wget healthcheck on `/`.
- **`apps/site/Caddyfile`:**
  - `get.zilar.app` at any path redirects 302 to `https://github.com/JulioFerrero/zilar/releases/latest/download/install.sh` (`:14-18`);
  - `/install.sh` does the same (`:21-24`);
  - the apex redirects to www (`:28-29`);
  - security headers;
  - `/assets/*` is cached immutable and `/index.html` gets `no-cache` (`:42-44`).
- **The old Vite site:**
  - `apps/site/index.html`, `vite.config.ts`, `src/**` (with the tests `src/cap.test.ts` and `src/demo.test.ts`), `public/**` and `README.md`;
  - the package name is `@zilar/site`.
- **Other references:** `README.md:127` lists `apps/site`, and `docs/EFFECT_GUIDE.md:22` exempts `apps/site`. Nothing else outside the package references it (`git grep`, 2026-10-16).

### Steps
1. **Delete the old Vite site:** `apps/site/index.html`, `apps/site/vite.config.ts`, `apps/site/src/**` and `apps/site/README.md`. `apps/site/public/**` is replaced by `apps/site-next/public/**`.
2. **Move everything** from `apps/site-next/` to `apps/site/` with `git mv`, and rename the package to `@zilar/site`. Then `apps/site-next` no longer exists.
3. **`apps/site/Dockerfile`:**
   - copy `apps/site/out` instead of `dist`;
   - make sure the build stage has what `next build` needs: `NEXT_TELEMETRY_DISABLED=1`, and no network calls at build time beyond the Google fonts that `next/font` fetches. If those can't be fetched in the build container, say so in the report;
   - keep the healthcheck.
4. **`apps/site/Caddyfile`:**
   - replace the `/assets/*` cache rule with `/_next/static/*` (immutable, one year);
   - keep `/index.html` at `no-cache`, and add `try_files {path} {path}.html {path}/index.html`, so clean URLs work with the static export;
   - keep every redirect and header unchanged.
5. **Docs:** `README.md:127` becomes "The website at www.zilar.app (Next.js, static export)". `docs/EFFECT_GUIDE.md:22` stays as is (the path is the same).
6. **Check the image builds:** run `docker build -f apps/site/Dockerfile .` from the repo root if Docker is available, and report the result. If it isn't available, say so; don't install anything.
7. **No new tests.**

### Allowed files
- `apps/site/**`
- `apps/site-next/**`
- `README.md`
- `pnpm-lock.yaml`
- `work/T-1735-site-swap.md`

### Checks
```bash
pnpm --filter @zilar/site build
pnpm gate
```

### Acceptance
- **`apps/site` is the Next.js landing,** and `apps/site-next` is gone.
- **The Dockerfile** serves `out/` with Caddy.
- **The get.zilar.app, /install.sh and apex redirects are unchanged.**
- **The build and the gate pass.**

---

## Report (written by the worker when done)

### What I did

- **Deleted the old Vite site:** `apps/site/index.html`, `apps/site/vite.config.ts`, `apps/site/src/**` (including `src/cap.test.ts` and `src/demo.test.ts`), `apps/site/README.md`, the old `apps/site/public/**`, and the Vite `package.json`/`tsconfig.json`.
- **Moved the Next.js landing** from `apps/site-next/` into `apps/site/` with `git mv`: `.gitignore`, `app/`, `components/`, `lib/`, `public/`, `next.config.ts`, `package.json`, `tsconfig.json`. `apps/site-next` no longer exists.
- **Renamed the package** `@zilar/site-next` -> `@zilar/site` in `apps/site/package.json`.
- **`apps/site/Dockerfile`:** header now says "static Next.js export"; added `ENV NEXT_TELEMETRY_DISABLED=1`; the runtime stage copies `/repo/apps/site/out` (was `dist`) to `/srv/zilar-site`; healthcheck and the rest of the build stage are unchanged.
- **`apps/site/Caddyfile`:** the asset cache rule is now `@assets path /_next/static/*` (same `public, max-age=31536000, immutable` header); added `try_files {path} {path}.html {path}/index.html` before `file_server`; `/index.html` stays `no-cache`; every redirect (get.zilar.app, `/install.sh`, apex -> www) and all security headers are unchanged.
- **Docs:** `README.md:127` now reads "The website at www.zilar.app (Next.js, static export)". `docs/EFFECT_GUIDE.md:22` is untouched (same path).
- **Lockfile:** `pnpm install` regenerated `pnpm-lock.yaml`; the `apps/site` importer now holds the Next deps (`next`, `gsap`, `lenis`, `react`, `react-dom`, `@gsap/react`, `three`) and the `apps/site-next` importer is gone.
- Removed the leftover untracked `apps/site-next/node_modules` (gitignored, from the pre-swap install) so the directory is fully gone.
- **No new tests** (spec step 7). The only test files that existed were the deleted Vite `src/cap.test.ts` and `src/demo.test.ts`.

### Checks run

- `pnpm install --frozen-lockfile`: Done (base tree consistent before the swap).
- `pnpm --filter @zilar/site build`: **PASS**. `next build` (Next.js 16.4.2, Turbopack) generated 3/3 static pages; `apps/site/out` contains `index.html` and `_next/static/**`.
- `docker build -f apps/site/Dockerfile .`: **PASS** (Docker 29.8.1, exit 0). The builder fetched `next/font/google` (Archivo, Geist, Geist_Mono) successfully inside the container and the runtime stage copied `/repo/apps/site/out`.
- `pnpm gate`: **GATE PASS**. Summary lines:

```
gate: 93 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.4s)
PASS  lint  (1.0s)
PASS  typecheck  (2.8s)
PASS  effect  (1.2s)
SKIP tests @zilar/site (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead

- **Google fonts:** `next/font/google` fetches Archivo, Geist and Geist_Mono at build time. Both the local build and the Docker build fetched them successfully, so nothing is blocked here. A build environment with no outbound network would fail `next build`.
- The old `/assets/*` cache rule is gone. The export emits only `/_next/static/*` as hashed assets; files under `public/` (screens, textures, favicons, `og.jpg`) are served with no explicit cache header, exactly as they were before.
- Redirects were verified by reading the Caddyfile; I did not run Caddy itself (no route smoke test was possible without the live domain).
- The 93 changed paths are the expected swap: the `apps/site` tree now holds the Next.js files, the old `apps/site` Vite files and all of `apps/site-next` are deleted, plus the edited `README.md`, `Dockerfile`, `Caddyfile`, `pnpm-lock.yaml` and this task file.

## Review (written by Claude)

- **Accepted at `6afb6caff`.** The pre-review is clean and the packet is current. The worker's `docker build -f apps/site/Dockerfile .` passed, and the lead allowed it.
- **Caddy:**
  - `/_next/static/*` replaces `/assets/*` with the same immutable header;
  - `try_files` resolves clean URLs;
  - the redirects (get.zilar.app, `/install.sh`, apex to www) and the security headers are unchanged.
- **The old site** was one page. Its public files (`robots.txt`, `favicon.ico`/`.svg`, `icon.webp`, `apple-touch-icon.png`, `og.jpg`, `screens/`, `textures/`) are all in the new `out/`, and `og:image` points at `https://www.zilar.app/og.jpg`.
- **Smoke test by the lead:** `pnpm --filter @zilar/site build`, served, then a headless tour of the eight sections at 1440×900 and 390×844, with no page errors or failed requests.
- **Merged with `--hold`.** It goes live on the next push, which replaces www.zilar.app.
