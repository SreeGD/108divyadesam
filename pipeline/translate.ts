// Phase 3 — LLM-assisted English layer (transliteration + translation).
//
// Fills the `en` / `translit` (and verse `meaning`) fields of the dataset:
//   1. Applies the hand-curated seed (pipeline/seed-translations.json) → review:"verified".
//   2. For everything still pending, calls the Claude API in batches and marks review:"auto".
//
// Resumable: every API result is cached in data/cache/translations.json keyed by a
// content hash, so re-runs skip completed work and a crash loses at most one batch.
// Offline-safe: with no ANTHROPIC_API_KEY it still applies the seed + cache and reports
// what remains, so the navigation chrome is English even without a key.
//
// Usage:
//   pnpm translate --scope=names            # temple/city/section/title names (small, cheap)
//   pnpm translate --scope=verses           # the ~5400 pasurams (the long pole)
//   pnpm translate --scope=all --limit=200  # cap API calls this run (incremental)
//   pnpm translate --dry-run                # apply seed + report counts, no API calls
//
// Model defaults to claude-opus-4-8; override with MODEL=claude-haiku-4-5 etc. for cost.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATASET = join(ROOT, "data/dataset");
const CACHE_DIR = join(ROOT, "data/cache");
const CACHE_FILE = join(CACHE_DIR, "translations.json");
const SEED_FILE = join(ROOT, "pipeline/seed-translations.json");
const TEMPLE_SEED_FILE = join(ROOT, "pipeline/seed-temples.json");
const VERSE_SEED_FILE = join(ROOT, "pipeline/seed-verses.json");
const GEN_VERSE_FILE = join(ROOT, "data/cache/verse-translations.json");
const GEN_NAMES_FILE = join(ROOT, "data/cache/name-translations.json");

const MODEL = process.env.MODEL ?? "claude-opus-4-8";
const NAME_BATCH = 25;
const VERSE_BATCH = 6;
const CONCURRENCY = 5;

type Kind = "name" | "verse";
interface Unit {
  // The live T/VerseText object to mutate in place.
  obj: { ta: string; en?: string; translit?: string; meaning?: string; review: string; flag?: string };
  kind: Kind;
}

// ---------- args ----------
const args = process.argv.slice(2);
const scope = (args.find((a) => a.startsWith("--scope="))?.split("=")[1] ?? "names") as
  | "names"
  | "verses"
  | "all";
const limit = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? Infinity);
const dryRun = args.includes("--dry-run");

// ---------- dataset I/O ----------
const FILES = ["regions", "cities", "temples", "alwars", "songbook", "song_index", "songs"];
const data: Record<string, any> = {};
for (const f of FILES) data[f] = JSON.parse(readFileSync(join(DATASET, `${f}.json`), "utf-8"));

function saveDataset(): void {
  for (const f of FILES) writeFileSync(join(DATASET, `${f}.json`), JSON.stringify(data[f], null, 2));
}

// ---------- collect translatable units ----------
function walkNames(node: any, out: Unit[]): void {
  if (Array.isArray(node)) {
    for (const x of node) walkNames(x, out);
    return;
  }
  if (node && typeof node === "object") {
    if (typeof node.ta === "string" && "review" in node) {
      out.push({ obj: node, kind: "name" });
      return; // don't recurse into a T leaf
    }
    for (const v of Object.values(node)) walkNames(v, out);
  }
}

function collectUnits(): Unit[] {
  const out: Unit[] = [];
  // Everything except songs: all T fields are "name" units.
  for (const f of ["regions", "cities", "temples", "alwars", "songbook", "song_index"]) {
    walkNames(data[f], out);
  }
  // Songs: titles are names; verse blocks are verse units.
  for (const song of data.songs) {
    if (song.title) walkNames(song.title, out);
    if (song.subTitle) walkNames(song.subTitle, out);
    for (const b of song.blocks ?? []) {
      if (b.type === "verse" && b.text) out.push({ obj: b.text, kind: "verse" });
      else walkNames(b, out);
    }
  }
  return out;
}

// ---------- seed ----------
function applySeed(units: Unit[]): number {
  const seed: Record<string, { en: string; translit: string }> = JSON.parse(
    readFileSync(SEED_FILE, "utf-8"),
  );
  let n = 0;
  for (const u of units) {
    const s = seed[u.obj.ta];
    if (s) {
      u.obj.en = s.en;
      u.obj.translit = s.translit;
      u.obj.review = "verified";
      n++;
    }
  }
  return n;
}

/** Apply the id-keyed temple seed (verified English names/places, keyed by refId). */
function applyTempleSeed(): number {
  const seed: Record<string, { name?: { en: string; translit: string }; place?: { en: string; translit: string } }> =
    JSON.parse(readFileSync(TEMPLE_SEED_FILE, "utf-8"));
  let n = 0;
  for (const t of data.temples) {
    const s = seed[String(t.refId)];
    if (!s) continue;
    for (const field of ["name", "place"] as const) {
      if (s[field]) {
        t[field].en = s[field]!.en;
        t[field].translit = s[field]!.translit;
        t[field].review = "verified";
        n++;
      }
    }
  }
  return n;
}

/** Apply hand-curated verse translations (translit + meaning), keyed by song id,
 *  arrays aligned to each song's verse blocks in order. */
function applyVerseSeed(): number {
  if (!existsSync(VERSE_SEED_FILE)) return 0;
  const seed: Record<string, { translit: string; meaning: string }[]> = JSON.parse(
    readFileSync(VERSE_SEED_FILE, "utf-8"),
  );
  let n = 0;
  for (const song of data.songs) {
    const arr = seed[song.id];
    if (!Array.isArray(arr)) continue;
    let i = 0;
    for (const b of song.blocks) {
      if (b.type === "verse" && b.text) {
        const e = arr[i++];
        if (e?.translit && e?.meaning) {
          b.text.translit = e.translit;
          b.text.meaning = e.meaning;
          b.text.review = "verified";
          n++;
        }
      }
    }
  }
  return n;
}

/** Apply machine-generated verse translations (review:"auto"), keyed by song id then
 *  verse-index string. Produced by the parallel translate-verses workflow. Hand-curated
 *  seed verses (review:"verified") always take precedence. */
function applyGeneratedVerses(): number {
  if (!existsSync(GEN_VERSE_FILE)) return 0;
  const gen: Record<string, Record<string, { translit: string; meaning: string }>> = JSON.parse(
    readFileSync(GEN_VERSE_FILE, "utf-8"),
  );
  let n = 0;
  for (const song of data.songs) {
    const m = gen[song.id];
    if (!m) continue;
    let i = 0;
    for (const b of song.blocks) {
      if (b.type === "verse" && b.text) {
        const e = m[String(i)];
        if (e?.translit && e?.meaning && b.text.review !== "verified") {
          b.text.translit = e.translit;
          b.text.meaning = e.meaning;
          b.text.review = "auto";
          n++;
        }
        i++;
      }
    }
  }
  return n;
}

/** Apply machine-generated name/heading translations (review:"auto"), keyed by Tamil
 *  string. Used for the song section headings translated separately. */
function applyGeneratedNames(units: Unit[]): number {
  if (!existsSync(GEN_NAMES_FILE)) return 0;
  const map: Record<string, { en?: string; translit?: string }> = JSON.parse(
    readFileSync(GEN_NAMES_FILE, "utf-8"),
  );
  let n = 0;
  for (const u of units) {
    if (u.kind !== "name" || u.obj.review === "verified") continue;
    const m = map[u.obj.ta];
    if (m?.en) {
      u.obj.en = m.en;
      if (m.translit) u.obj.translit = m.translit;
      u.obj.review = "auto";
      n++;
    }
  }
  return n;
}

// ---------- cache ----------
function cacheKey(kind: Kind, ta: string): string {
  return createHash("sha256").update(`${kind}${ta}`).digest("hex").slice(0, 24);
}
const cache: Record<string, { en?: string; translit?: string; meaning?: string }> = existsSync(
  CACHE_FILE,
)
  ? JSON.parse(readFileSync(CACHE_FILE, "utf-8"))
  : {};
function saveCache(): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

function applyFromCache(u: Unit): boolean {
  const c = cache[cacheKey(u.kind, u.obj.ta)];
  if (!c) return false;
  if (u.kind === "name") {
    if (c.en === undefined || c.translit === undefined) return false;
    u.obj.en = c.en;
    u.obj.translit = c.translit;
  } else {
    if (c.translit === undefined || c.meaning === undefined) return false;
    u.obj.translit = c.translit;
    u.obj.meaning = c.meaning;
  }
  u.obj.review = "auto";
  return true;
}

// ---------- API ----------
let client: any = null;
async function getClient(): Promise<any> {
  if (client) return client;
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  client = new Anthropic();
  return client;
}

const NAME_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { en: { type: "string" }, translit: { type: "string" } },
        required: ["en", "translit"],
      },
    },
  },
  required: ["items"],
};
const VERSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { translit: { type: "string" }, meaning: { type: "string" } },
        required: ["translit", "meaning"],
      },
    },
  },
  required: ["items"],
};

const NAME_SYS =
  "You are an expert in Tamil and Srivaishnava tradition. For each Tamil term (a temple name, " +
  "place, presiding deity, Alwar, or section/hymn title from the Naalayira Divya Prabandham), " +
  "return: `translit` — a faithful, readable Roman transliteration; and `en` — the natural English " +
  "name or meaning (use the conventional English spelling for well-known places and deities, e.g. " +
  "Srirangam, Ranganathar, Tirupati). Return items in the same order and count as the input.";

const VERSE_SYS =
  "You are an expert in Tamil and the Naalayira Divya Prabandham. For each pasuram (sacred Tamil " +
  "verse, lines separated by newlines), return: `translit` — a line-by-line Roman transliteration " +
  "preserving the line breaks; and `meaning` — a clear, faithful English prose translation of the " +
  "verse's meaning (2–5 sentences). Be reverent and accurate; do not add commentary beyond the " +
  "verse's content. Return items in the same order and count as the input.";

async function translateBatch(kind: Kind, texts: string[]): Promise<any[] | null> {
  const c = await getClient();
  const sys = kind === "name" ? NAME_SYS : VERSE_SYS;
  const schema = kind === "name" ? NAME_SCHEMA : VERSE_SCHEMA;
  const numbered = texts.map((t, i) => `[${i}]\n${t}`).join("\n\n---\n\n");
  try {
    const res = await c.messages.create({
      model: MODEL,
      max_tokens: kind === "name" ? 4000 : 8000,
      system: sys,
      output_config: { format: { type: "json_schema", schema } },
      messages: [
        {
          role: "user",
          content: `Translate these ${texts.length} item(s). Return exactly ${texts.length} item(s) in order.\n\n${numbered}`,
        },
      ],
    });
    const textBlock = res.content.find((b: any) => b.type === "text");
    const parsed = JSON.parse(textBlock.text);
    if (!Array.isArray(parsed.items) || parsed.items.length !== texts.length) return null;
    return parsed.items;
  } catch (e) {
    console.warn(`  ! batch failed: ${(e as Error).message}`);
    return null;
  }
}

async function mapLimit<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]!, idx);
      }
    }),
  );
  return out;
}

// ---------- run ----------
async function main(): Promise<void> {
  const units = collectUnits();
  const seeded = applySeed(units) + applyTempleSeed() + applyVerseSeed();
  const autoVerses = applyGeneratedVerses();
  if (autoVerses) console.log(`Applied ${autoVerses} machine-generated (auto) verse translations.`);
  const autoNames = applyGeneratedNames(units);
  if (autoNames) console.log(`Applied ${autoNames} machine-generated (auto) heading/name translations.`);

  // Apply anything already cached.
  let fromCache = 0;
  for (const u of units) {
    if (u.obj.review !== "verified" && applyFromCache(u)) fromCache++;
  }

  // What still needs the API, filtered by scope and deduplicated by (kind, ta).
  const wantKinds = scope === "all" ? ["name", "verse"] : scope === "names" ? ["name"] : ["verse"];
  const pendingByKey = new Map<string, { kind: Kind; ta: string; units: Unit[] }>();
  for (const u of units) {
    if (u.obj.review === "verified" || u.obj.review === "auto") continue;
    if (!wantKinds.includes(u.kind)) continue;
    const key = cacheKey(u.kind, u.obj.ta);
    if (!pendingByKey.has(key)) pendingByKey.set(key, { kind: u.kind, ta: u.obj.ta, units: [] });
    pendingByKey.get(key)!.units.push(u);
  }
  const pending = [...pendingByKey.values()];

  const total = units.length;
  console.log(
    `Units: ${total} | seeded(verified): ${seeded} | from cache: ${fromCache} | ` +
      `pending API (${scope}): ${pending.length} distinct`,
  );

  if (dryRun) {
    saveDataset();
    console.log("Dry run — dataset saved with seed/cache applied; no API calls made.");
    return;
  }

  const hasKey = !!process.env.ANTHROPIC_API_KEY || !!process.env.ANTHROPIC_AUTH_TOKEN;
  if (pending.length && !hasKey) {
    saveDataset();
    console.log(
      "\nNo ANTHROPIC_API_KEY set — applied seed + cache only. Set a key and re-run to translate the rest.",
    );
    return;
  }

  // Build batches (respecting --limit on number of API calls this run).
  const names = pending.filter((p) => p.kind === "name");
  const verses = pending.filter((p) => p.kind === "verse");
  const batches: { kind: Kind; group: typeof pending }[] = [];
  for (let i = 0; i < names.length; i += NAME_BATCH)
    batches.push({ kind: "name", group: names.slice(i, i + NAME_BATCH) });
  for (let i = 0; i < verses.length; i += VERSE_BATCH)
    batches.push({ kind: "verse", group: verses.slice(i, i + VERSE_BATCH) });
  const runBatches = Number.isFinite(limit) ? batches.slice(0, limit) : batches;

  console.log(`Translating ${runBatches.length}/${batches.length} batches with ${MODEL}…`);
  let done = 0;
  await mapLimit(runBatches, CONCURRENCY, async (batch) => {
    const items = await translateBatch(batch.kind, batch.group.map((g) => g.ta));
    if (!items) return;
    batch.group.forEach((g, i) => {
      const r = items[i] ?? {};
      const entry =
        batch.kind === "name"
          ? { en: r.en, translit: r.translit }
          : { translit: r.translit, meaning: r.meaning };
      cache[cacheKey(batch.kind, g.ta)] = entry;
      for (const u of g.units) applyFromCache(u);
    });
    done++;
    if (done % 10 === 0) {
      saveCache();
      console.log(`  …${done}/${runBatches.length} batches`);
    }
  });

  saveCache();
  saveDataset();

  // Coverage report.
  const cov = (kind: Kind) => {
    const us = units.filter((u) => u.kind === kind);
    const translated = us.filter((u) => u.obj.review !== "pending").length;
    return `${translated}/${us.length}`;
  };
  console.log(`\n✓ Done. Coverage — names: ${cov("name")} | verses: ${cov("verse")}`);
  if (Number.isFinite(limit) && runBatches.length < batches.length)
    console.log(`  (--limit hit; ${batches.length - runBatches.length} batches remain — re-run to continue)`);
}

main();
