# Deploying the 108 Divya Desam site

The site is a **static Astro build** — just HTML/CSS/JS + images in `site/dist`. Any
static host works. The build reads the committed `data/dataset/*.json` (which already
has all translations baked in), so the host only needs Node + pnpm to run the Astro build.

Set **`SITE_URL`** to your final URL — it drives the canonical tags and `sitemap.xml`.

---

## Option A — Direct deploy, no Git repo (fastest)

Build locally, push the `dist/` folder straight to a host's CLI.

```bash
cd site
SITE_URL="https://YOUR-URL" pnpm build      # → site/dist

# then ONE of:
npx netlify-cli deploy --prod --dir=dist            # Netlify (prompts login first run)
npx vercel deploy --prebuilt --prod                 # Vercel (run `npx vercel` once to link)
npx wrangler pages deploy dist --project-name=divyadesam   # Cloudflare Pages
```

Or drag-and-drop `site/dist` onto https://app.netlify.com/drop — no account/login needed for a quick preview URL.

---

## Option B — Git + CI (auto-deploy on every push)

1. Create the repo (this project isn't a git repo yet):
   ```bash
   cd /Users/sree/Projects/108divyadesam
   git init && git add -A && git commit -m "108 Divya Desam bilingual site"
   gh repo create 108divyadesam --public --source=. --push     # or add a remote manually
   ```
2. Connect the host to the repo:
   - **Netlify** / **Vercel** / **Cloudflare Pages**: "New site from Git" → pick the repo. The committed `netlify.toml` / `vercel.json` already set the build command, output dir, and image caching. Set `SITE_URL` in the host's env vars.
   - **GitHub Pages**: the included `.github/workflows/deploy.yml` builds and deploys on push to `main`. In repo **Settings → Pages**, set Source = "GitHub Actions". Add a repo **Variable** `SITE_URL` (Settings → Secrets and variables → Actions → Variables). For a project page the URL is `https://<user>.github.io/<repo>/`.

---

## Custom domain

Point your domain at the host (their dashboard walks you through DNS), then set
`SITE_URL=https://yourdomain.org` and rebuild so canonical/sitemap match.

---

## Re-deploying after content changes

If you edit translations (`pipeline/seed-*.json`) or re-run the translation workflow,
re-apply and rebuild before deploying:

```bash
python3 pipeline/merge-wf.py          # only if you ran a new translation workflow
pnpm translate --scope=all --dry-run  # re-applies seeds + machine translations into data/dataset
cd site && pnpm build                 # → site/dist
```

With Git+CI (Option B), just commit and push — the host rebuilds automatically.

## What must be committed for the build to work

- `data/dataset/**` — the normalized dataset **with translations applied** (not ignored)
- `data/cache/verse-translations.json` — the merged machine translations (kept; the rest of `data/cache/` is ignored)
- `site/public/img/**` — the 238 temple/Alwar images (not ignored)
- `site/**` source, `netlify.toml` / `vercel.json` / `.github/workflows/deploy.yml`
