# 108 Divya Desam — Bilingual (Tamil + English) Website

An English-language website built from the content of the Tamil Android app
`com.coderays.divyadesam`, so the **108 Divya Desams** — the sacred abodes of Vishnu
sung by the twelve Alwars in the Naalayira Divya Prabandham — can be read by anyone,
anywhere. Every name, place, and verse is shown in the original Tamil alongside an
English transliteration and meaning.

## What's here

```
data/raw/        Content extracted from the APK (source of truth, read-only)
data/harvested/  Server config + downloaded images (cached)
data/dataset/    Normalized BILINGUAL dataset the site reads (generated)
data/cache/      Resumable translation cache (generated)
pipeline/        Node/TS build pipeline (extract → harvest → translate)
site/            Astro static website (reads data/dataset)
```

The dataset covers **108 temples**, **12 Alwars**, **7 regions**, 204 Alwar→temple
mangalasasanam links, and **5,419 verses** across 465 hymn sections.

## Pipeline

Run from the repo root (`pnpm install` first):

| Command | What it does |
|---|---|
| `pnpm extract` | Parse `data/raw` (SQL + JSON) → normalized `data/dataset/*.json`. Deterministic, no AI. Writes `gaps.json` for known source defects. |
| `pnpm harvest` | Resolve the live image host and download all 238 temple/Alwar images into `site/public/img` (resumable). |
| `pnpm translate --scope=all --dry-run` | Apply the verified seed (`pipeline/seed-translations.json`) + any cache; report coverage. No API calls. |
| `pnpm translate --scope=names` | Translate temple/place/section names (small, cheap). **Needs `ANTHROPIC_API_KEY`.** |
| `pnpm translate --scope=verses` | Transliterate + translate the ~5,400 pasurams (the long pole). Resumable; `--limit=N` caps API calls per run. |

The translation layer is **machine-assisted with review markers**: anything in a
seed file is `verified`; anything the API fills is `auto`; anything untranslated
renders with a `(draft)` marker. The Tamil source is always preserved as the
authority.

### Curated (no API key) — the primary path

English is supplied by hand-written **seed files**, applied deterministically by
`pnpm translate` (no API calls, no key):

| Seed file | Covers |
|---|---|
| `pipeline/seed-translations.json` | Regions, Alwars, menu captions, hymn-section titles (keyed by Tamil string) |
| `pipeline/seed-temples.json` | All **108 temple names + places** (keyed by `refId`) |
| `pipeline/seed-verses.json` | Per-hymn verse translations — transliteration + meaning (keyed by song id; arrays aligned to verse order). Grows hymn by hymn. |

After editing any seed, run `pnpm translate --scope=all --dry-run` (applies seeds,
no API) then rebuild the site. Currently the full temple/Alwar/region/hymn-title
layer is verified, plus the complete opening hymn (Thiruppallandu, 14 verses) as a
worked example. Remaining verse meanings are added to `seed-verses.json` over time.

### Optional API fallback

To machine-draft the remaining ~5,400 verses in bulk instead of by hand, set a key
and run the same command — it fills only what the seeds haven't:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
pnpm translate --scope=verses           # resumable; --limit=N caps calls per run
```

Model defaults to `claude-opus-4-8`; override with `MODEL=claude-haiku-4-5` for cost.

## Website

```bash
cd site
pnpm install
pnpm dev      # local dev server
pnpm build    # static site → site/dist
```

Pages: home (regions + Alwars), region listings, temple pages (image, map,
mangalasasanam, sections), Alwar pages (birthplace, hymns, temples sung), and a
hymn reader with a Tamil / transliteration / English-meaning toggle. Bilingual SEO
(canonical + `hreflang`, sitemap). Deploy `site/dist` to any static host
(Netlify / Vercel / GitHub Pages); set `SITE_URL` for correct sitemap URLs.

## Known gaps (see `data/dataset/gaps.json`)

- **6 hymn files** are corrupted inside the source APK (they contain ZIP fragments,
  not JSON) and are skipped — backfill from a clean APK or the publisher.
- **Temple Sthala-Puranam / festival / timing prose** and **Alwar biographies** are
  served by the publisher's app API behind an auth/signature we don't replicate, so
  they are not harvested; the section structure is shown and the prose can be
  generated in English or sourced separately.
- Images and any server-sourced prose are the original publisher's — confirm
  redistribution rights before publishing.
