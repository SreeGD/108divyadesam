// Phase 2 — Harvest server assets.
//
// Findings from probing the live server (still up in 2026):
//   • get_remoteconfig.php returns the real image host (the host baked into the
//     2021 APK is stale). Current host: d2z0jhnf0i5jj3.cloudfront.net.
//   • Images are public on CloudFront and download cleanly (GET → image/webp).
//   • The text endpoints (get_templeDetails / get_alwarDetails) use a dTime sync
//     protocol that returns empty `data` without an app-side auth/signature we
//     don't have. So temple history/festival/timing + Alwar bios are NOT
//     harvestable here — they are generated in English in Phase 3 (translate)
//     and flagged for review. Recorded in data/dataset/gaps.json.
//
// This script therefore (1) resolves the live image host, (2) downloads every
// referenced image into site/public/img (resumable — skips existing files).

import { mkdirSync, existsSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ImageRef, Temple, Alwar, Song } from "./types.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATASET = join(ROOT, "data/dataset");
const HARVEST = join(ROOT, "data/harvested");
const PUBLIC_IMG = join(ROOT, "site/public");

const REMOTE_CONFIG_URL =
  "http://divyadesam.omtamilcalendar.com/apps_v1/api/get_remoteconfig.php";
const FALLBACK_HOST = "d2z0jhnf0i5jj3.cloudfront.net";

function readDataset<T>(name: string): T {
  return JSON.parse(readFileSync(join(DATASET, name), "utf-8")) as T;
}

async function resolveImageHost(): Promise<string> {
  try {
    const res = await fetch(REMOTE_CONFIG_URL, { signal: AbortSignal.timeout(15000) });
    const json: any = await res.json();
    const host = json?.data?.IMG_HOSTNAME;
    mkdirSync(HARVEST, { recursive: true });
    writeFileSync(join(HARVEST, "remoteconfig.json"), JSON.stringify(json, null, 2));
    if (typeof host === "string" && host.length) {
      console.log(`Resolved image host from server: ${host}`);
      return host;
    }
  } catch (e) {
    console.warn(`remoteconfig fetch failed (${(e as Error).message}); using fallback host`);
  }
  return FALLBACK_HOST;
}

/** Collect every distinct ImageRef (with a real id+path) referenced in the dataset. */
function collectImageRefs(): ImageRef[] {
  const temples = readDataset<Temple[]>("temples.json");
  const alwars = readDataset<Alwar[]>("alwars.json");
  const songs = readDataset<Song[]>("songs.json");
  const byPath = new Map<string, ImageRef>();
  const add = (r?: ImageRef | { rawUrl: string }) => {
    if (r && "path" in r && r.path && r.path.includes("/apps_v1/assets/")) byPath.set(r.path, r);
  };
  for (const t of temples) {
    add(t.images.thumb);
    add(t.images.zoom);
  }
  for (const a of alwars) add(a.image);
  for (const s of songs) for (const b of s.blocks) if (b.type === "image") add(b.image as any);
  return [...byPath.values()];
}

async function download(host: string, ref: ImageRef): Promise<"ok" | "skip" | "fail"> {
  const dest = join(PUBLIC_IMG, ref.local); // ref.local = /img/...
  if (existsSync(dest) && statSync(dest).size > 0) return "skip";
  const url = `https://${host}${ref.path}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) {
      console.warn(`  ! ${res.status} ${url}`);
      return "fail";
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return "fail";
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, buf);
    return "ok";
  } catch (e) {
    console.warn(`  ! ${(e as Error).message} ${url}`);
    return "fail";
  }
}

/** Simple bounded-concurrency map. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        results[idx] = await fn(items[idx]!);
      }
    }),
  );
  return results;
}

async function main(): Promise<void> {
  const host = await resolveImageHost();
  const refs = collectImageRefs();
  console.log(`Downloading ${refs.length} images → site/public/img (resumable)\n`);

  const outcomes = await mapLimit(refs, 8, (r) => download(host, r));
  const tally = outcomes.reduce(
    (a, o) => ((a[o] = (a[o] ?? 0) + 1), a),
    {} as Record<string, number>,
  );
  console.log("\nImages:", JSON.stringify(tally));

  const failed = refs.filter((_, i) => outcomes[i] === "fail").map((r) => r.path);
  const harvestReport = {
    imageHost: host,
    totalImages: refs.length,
    downloaded: tally.ok ?? 0,
    skippedExisting: tally.skip ?? 0,
    failed,
    proseNote:
      "Temple history/festival/timing and Alwar biographies are not available from the server " +
      "API (dTime-sync endpoint returns empty without app auth). These are generated in English " +
      "during Phase 3 (translate) and flagged review:auto.",
  };
  mkdirSync(HARVEST, { recursive: true });
  writeFileSync(join(HARVEST, "harvest-report.json"), JSON.stringify(harvestReport, null, 2));
  console.log(`\n✓ Harvest done. Report: data/harvested/harvest-report.json`);
  if (failed.length) console.log(`  (${failed.length} images failed — see report)`);
}

main();
