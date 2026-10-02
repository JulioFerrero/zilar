# Zilar landing page

The page for `zilar.app`: plain HTML and CSS. No build step, no framework, no scripts, nothing loaded from other hosts.

- `index.html`, `styles.css`: the page. It follows the app's look (`docs/design/ui-style.md`).
- `assets/`: the icon (WebP), the social card (`og.jpg`) and screenshots. The screenshots come from `docs/screenshots` and use demo data. The icon comes from `assets/brand` (see `tools/brand-3d`).
- `favicon.svg`, `favicon.ico`, `apple-touch-icon.png`: copies of the web app's icons. Rebuild them with `sh tools/brand-3d/build-assets.sh`, then copy them again.

## Preview

```bash
cd site && python3 -m http.server 5197
```

## Deploy

Serve the `site/` folder as a static site from the root of `zilar.app` (Cloudflare Pages, Coolify's static site, nginx, any bucket). The publish directory is `site`, with no build command. Notes:

- The `og:image` and `og:url` tags use the absolute URL `https://zilar.app`.
- The "Early access" buttons are `mailto:hello@zilar.app`. That mailbox has to exist before the page goes public.
- Redirect `www.zilar.app` and `zilar.org` to `https://zilar.app`.
- Optional security headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self'`. The page needs no inline scripts or styles.

`packages/devtools/src/site.test.ts` checks that every file the page references exists and that nothing is loaded from another host.
