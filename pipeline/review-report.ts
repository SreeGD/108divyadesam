// Generates a human-review report for machine-assisted translations.
// Focus: the verse translations marked review:"auto" (the parallel-workflow drafts),
// so a Tamil/Srivaishnava scholar can verify them before publishing. Also lists any
// other translatable field still not "verified".
//
// Outputs (in data/review/):
//   verses-to-review.csv  — one row per non-verified verse: section context, Tamil,
//                           transliteration, meaning, review status. Open in any spreadsheet.
//   summary.md            — counts + per-work coverage + how to mark verses verified.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATASET = join(ROOT, "data/dataset");
const OUT = join(ROOT, "data/review");

const load = <T>(name: string): T => JSON.parse(readFileSync(join(DATASET, name), "utf-8")) as T;

interface T {
  ta: string;
  en?: string;
  translit?: string;
  meaning?: string;
  review: "pending" | "auto" | "verified";
  flag?: string;
}
interface Song {
  id: string;
  title?: T;
  blocks: { type: string; title?: T; text?: T; songNum?: string }[];
}

const songs = load<Song[]>("songs.json");

function csvCell(s: unknown): string {
  const v = String(s ?? "");
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

interface Row {
  songId: string;
  work: string;
  section: string;
  songNum: string;
  verseIndex: number;
  review: string;
  flag: string;
  tamil: string;
  translit: string;
  meaning: string;
}

const rows: Row[] = [];
const perWork = new Map<string, { id: string; work: string; total: number; auto: number; pending: number; verified: number }>();

for (const song of songs) {
  const workName = song.title?.en || song.title?.translit || song.title?.ta || song.id;
  let section = "";
  let verseIndex = -1;
  const stat = perWork.get(song.id) ?? { id: song.id, work: workName, total: 0, auto: 0, pending: 0, verified: 0 };
  for (const b of song.blocks) {
    if (b.type === "head" || b.type === "subHead") {
      const title = b.title?.en || b.title?.translit || b.title?.ta || "";
      if (b.type === "head") section = title;
      else if (title) section = section ? `${section} — ${title}` : title;
    }
    if (b.type === "verse" && b.text) {
      verseIndex++;
      const t = b.text;
      stat.total++;
      stat[t.review === "auto" ? "auto" : t.review === "verified" ? "verified" : "pending"]++;
      if (t.review !== "verified") {
        rows.push({
          songId: song.id,
          work: workName,
          section,
          songNum: b.songNum ?? "",
          verseIndex,
          review: t.review,
          flag: t.flag ?? "",
          tamil: t.ta,
          translit: t.translit ?? "",
          meaning: t.meaning ?? "",
        });
      }
    }
  }
  perWork.set(song.id, stat);
}

mkdirSync(OUT, { recursive: true });

// ---- CSV ----
const header = ["songId", "work", "section", "songNum", "verseIndex", "review", "flag", "tamil", "translit", "meaning"];
const csv = [
  header.join(","),
  ...rows.map((r) =>
    [r.songId, r.work, r.section, r.songNum, r.verseIndex, r.review, r.flag, r.tamil, r.translit, r.meaning]
      .map(csvCell)
      .join(","),
  ),
].join("\n");
writeFileSync(join(OUT, "verses-to-review.csv"), csv);

// ---- summary.md ----
const totals = rows.reduce(
  (a, r) => ((a[r.review] = (a[r.review] ?? 0) + 1), a),
  {} as Record<string, number>,
);
const works = [...perWork.values()].filter((w) => w.auto + w.pending > 0).sort((a, b) => b.auto + b.pending - (a.auto + a.pending));
const md = `# Translation review report

Machine-assisted verse translations awaiting human (scholar) review. The hand-curated
verses (review: **verified**) are excluded — they are already checked.

- **${totals.auto ?? 0}** verses are machine-drafted (review: \`auto\`) — the parallel workflow output.
- **${totals.pending ?? 0}** verses are still untranslated (review: \`pending\`).
- **${rows.length}** total rows in \`verses-to-review.csv\`.

Open **\`data/review/verses-to-review.csv\`** in any spreadsheet. Columns:
\`songId, work, section, songNum, verseIndex, review, flag, tamil, translit, meaning\`.
Read each Tamil verse against its transliteration + meaning and correct as needed.

## How to mark a verse verified after review

The drafts live in \`data/cache/verse-translations.json\` keyed by \`songId\` then verse index.
To promote corrected verses to **verified**, add them (with your corrected text) to
\`pipeline/seed-verses.json\` under their \`songId\` as a contiguous array aligned to
\`verseIndex\` — the seed always overrides the machine draft. Then re-run:

\`\`\`
pnpm translate --scope=all --dry-run && (cd site && pnpm build)
\`\`\`

## Verses needing review, by work (most first)

| Work | songId | to review (auto + pending) | verified |
|---|---|--:|--:|
${works.map((w) => `| ${w.work} | ${w.id} | ${w.auto + w.pending} | ${w.verified} |`).join("\n")}
`;
writeFileSync(join(OUT, "summary.md"), md);

console.log(`Review report written to data/review/`);
console.log(`  verses-to-review.csv : ${rows.length} rows (${totals.auto ?? 0} auto, ${totals.pending ?? 0} pending)`);
console.log(`  summary.md           : per-work breakdown across ${works.length} works`);
