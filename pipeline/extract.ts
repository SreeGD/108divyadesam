// Phase 1 — Deterministic extraction (no AI).
// Parses the bundled Tamil assets in data/raw into a normalized bilingual
// dataset under data/dataset. English/transliteration fields are left empty
// (review: "pending") for the translation pipeline to fill.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseInserts, readTolerant, imageRefFromUrl } from "./lib.ts";
import {
  t,
  verseText,
  type Region,
  type City,
  type Temple,
  type Alwar,
  type AlwarTempleLink,
  type Song,
  type SongBlock,
  type SongbookSection,
} from "./types.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = join(ROOT, "data/raw");
const OUT = join(ROOT, "data/dataset");

function readJson(name: string): any {
  return JSON.parse(readTolerant(join(RAW, name)));
}
function write(name: string, data: unknown): void {
  const p = join(OUT, name);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(data, null, 2));
}

// ---------- Regions (dashboard.json) ----------
function extractRegions(): Region[] {
  const { list } = readJson("dashboard.json");
  return list.map((r: any) => ({
    code: r.code,
    icon: r.icon,
    name: t(r.tm.name),
    templeCount: r.tCount,
  }));
}

// ---------- Cities (location.json + city_filter.json) ----------
function extractCities(): City[] {
  const { list } = readJson("location.json");
  const filter = readJson("city_filter.json").sectionlist as Record<string, any>;
  const cityToRegion = new Map<number, number>();
  for (const [regionCode, section] of Object.entries(filter)) {
    for (const c of section.location ?? []) cityToRegion.set(c.code, Number(regionCode));
  }
  return list.map((c: any) => ({
    code: c.code,
    icon: c.icon,
    name: t(c.tm.name),
    templeCount: c.tCount,
    regionCode: cityToRegion.get(c.code),
  }));
}

// ---------- Temples (templelist.sql) ----------
function extractTemples(): Temple[] {
  const sql = readTolerant(join(RAW, "templelist.sql"));
  const rows = parseInserts(sql).filter((r) => r.table === "tlist");
  return rows.map((row) => {
    const v = Object.fromEntries(row.cols.map((c, i) => [c, row.values[i]]));
    const listData = JSON.parse(v.listData!);
    const tData = JSON.parse(v.tData!);
    return {
      refId: Number(v.refId),
      regionCode: Number(v.sId),
      cityCode: Number(v.lId),
      name: t(listData.name),
      place: t(listData.place),
      lat: Number(v.lati),
      lng: Number(v.longi),
      weight: Number(v.weight),
      images: {
        thumb: imageRefFromUrl(listData.tImg),
        zoom: imageRefFromUrl(tData.bImg),
      },
      menu: (tData.menuList ?? []).map((mi: any) => ({
        code: mi.code,
        caption: t(mi.caption),
      })),
    } satisfies Temple;
  });
}

// ---------- Alwars (alwar_dashboard.json + alwar_desc.sql) ----------
function extractAlwars(): Alwar[] {
  const { list } = readJson("alwar_dashboard.json");
  const descRows = parseInserts(readTolerant(join(RAW, "alwar_desc.sql"))).filter(
    (r) => r.table === "alwardesc",
  );

  // Index alwar_desc rows by (refId, menuCode).
  const byAlwar = new Map<number, Record<string, any>>();
  for (const row of descRows) {
    const v = Object.fromEntries(row.cols.map((c, i) => [c, row.values[i]]));
    const refId = Number(v.refId);
    const desc = JSON.parse(v.aDesc!);
    if (!byAlwar.has(refId)) byAlwar.set(refId, {});
    byAlwar.get(refId)![v.menuCode!] = desc;
  }

  return list.map((a: any) => {
    const index = byAlwar.get(a.code)?.["ALWAR_INDEX"];
    const songsDesc = byAlwar.get(a.code)?.["ALWAR_SONGS"];
    let avatara: number | undefined;
    let image;
    if (index) {
      const av = (index.menuList ?? []).find((mi: any) => mi.code === "AVADHARATHALAM");
      avatara = av?.tId;
      if (index.bImg) image = imageRefFromUrl(index.bImg);
    }
    const songs = (songsDesc?.list ?? songsDesc?.menuList ?? [])
      .filter((s: any) => s?.tm?.name || s?.caption)
      .map((s: any) => ({
        title: t(s.tm?.name ?? s.caption ?? ""),
        subTitle: s.tm?.subTitle ? t(s.tm.subTitle) : undefined,
        fName: s.fName,
        code: s.code !== undefined ? Number(s.code) : undefined,
      }));
    return {
      code: a.code,
      icon: a.icon,
      name: t(a.tm.name),
      avataraSthalamTempleId: avatara,
      image,
      songs,
    } satisfies Alwar;
  });
}

// ---------- Alwar→Temple links (alwar_temples.sql) ----------
// Columns are (tId, refId, weight) where tId = temple refId and refId = Alwar
// dashboard code (1..12). Verified by frequency: Alwar 12 (Thirumangai) → 85
// temples, Alwar 5 (Nammalwar) → 35, Alwar 6 (Madhurakavi) → 0, matching tradition.
function extractAlwarTempleLinks(): { links: AlwarTempleLink[]; anomalies: AlwarTempleLink[] } {
  const rows = parseInserts(readTolerant(join(RAW, "alwar_temples.sql"))).filter(
    (r) => r.table === "alwartemples",
  );
  const links: AlwarTempleLink[] = [];
  const anomalies: AlwarTempleLink[] = [];
  for (const row of rows) {
    const v = Object.fromEntries(row.cols.map((c, i) => [c, Number(row.values[i])]));
    const link = { alwarCode: v.refId!, templeRefId: v.tId!, weight: v.weight! };
    if (link.alwarCode >= 1 && link.alwarCode <= 12) links.push(link);
    else anomalies.push(link); // stray Alwar id 23 (2 rows)
  }
  return { links, anomalies };
}

// ---------- Songbook sections (dp_dashboard.json) ----------
function extractSongbook(): SongbookSection[] {
  const { list } = readJson("dp_dashboard.json");
  return list.map((s: any) => ({
    code: s.code,
    name: t(s.tm.name),
    fName: s.fName ?? "",
    isList: s.isList === "Y",
    icon: s.icon,
    sIndex: s.sIndex ?? "",
  }));
}

// ---------- Song index (song_index.sql) ----------
function extractSongIndex(): any[] {
  const rows = parseInserts(readTolerant(join(RAW, "song_index.sql"))).filter(
    (r) => r.table === "songindex",
  );
  return rows.map((row) => {
    const v = Object.fromEntries(row.cols.map((c, i) => [c, row.values[i]]));
    const item = JSON.parse(v.listItem!).tm ?? {};
    return {
      refId: Number(v.refId),
      weight: Number(v.weight),
      title: t(item.title ?? ""),
      subTitle: item.subTitle ? t(item.subTitle) : undefined,
      fName: item.fName ?? "",
      code: item.code,
    };
  });
}

// ---------- Songs (dpsongs/*.json) ----------
function normalizeBlock(b: any): SongBlock | null {
  switch (b.type) {
    case "head":
      return { type: "head", title: t(b.title ?? ""), subTitle: b.subTitle ? t(b.subTitle) : undefined, fontSize: b.fontSize };
    case "subHead":
      return { type: "subHead", title: t(b.title ?? ""), align: b.align, fontSize: b.fontSize };
    case "horizontalSV":
    case "verticalSV":
    case "plainText": {
      const raw = (b.desc ?? "")
        .replace(/\[NL\]/g, "\n")
        .replace(/\[TAB\]/g, " ")
        .replace(/\n+$/g, "")
        .trim();
      if (!raw) return null;
      return { type: "verse", songNum: String(b.songNum ?? ""), text: verseText(raw) };
    }
    case "image":
      return {
        type: "image",
        image: b.isDrawable === "Y" ? { rawUrl: b.imgurl } : imageRefFromUrl(b.imgurl ?? ""),
        caption: b.imgCaption ? t(b.imgCaption) : undefined,
      };
    default:
      return null;
  }
}

function extractSongs(): { songs: Song[]; verseCount: number; corrupted: string[] } {
  const dir = join(RAW, "dpsongs");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const songs: Song[] = [];
  const corrupted: string[] = [];
  let verseCount = 0;
  for (const file of files.sort()) {
    let parsed: any;
    try {
      parsed = JSON.parse(readTolerant(join(dir, file)));
    } catch {
      // These files are corrupted inside the repackaged APK (they contain ZIP
      // resource fragments, not JSON). Recorded as a gap to backfill later.
      corrupted.push(`dpsongs/${file}`);
      continue;
    }
    // Each file is one hymn section; its internal keys (which collide across
    // files) are sub-sections. Merge them in order into a single song whose id
    // is the file basename — the stable id that `fName` references resolve to.
    const id = file.replace(/\.json$/, "");
    const blocks: SongBlock[] = [];
    for (const val of Object.values<any>(parsed)) {
      const list = val?.data?.list;
      if (!Array.isArray(list)) continue;
      for (const b of list) {
        const nb = normalizeBlock(b);
        if (nb) blocks.push(nb);
      }
    }
    if (!blocks.length) continue;
    verseCount += blocks.filter((b) => b.type === "verse").length;
    const firstHead = blocks.find((b) => b.type === "head") as any;
    songs.push({ id, sourceFile: `dpsongs/${file}`, title: firstHead?.title, blocks });
  }
  return { songs, verseCount, corrupted };
}

// ---------- Run ----------
function main(): void {
  console.log("Extracting bundled assets → data/dataset\n");

  const regions = extractRegions();
  const cities = extractCities();
  const temples = extractTemples();
  const alwars = extractAlwars();
  const { links, anomalies } = extractAlwarTempleLinks();
  const songbook = extractSongbook();
  const songIndex = extractSongIndex();
  const { songs, verseCount, corrupted } = extractSongs();

  // Temple ids referenced as Alwar avatara sthalams that fall outside the 108 set.
  const templeIds = new Set(temples.map((t) => t.refId));
  const extendedTempleIds = [
    ...new Set(
      alwars
        .map((a) => a.avataraSthalamTempleId)
        .filter((id): id is number => !!id && id > 0 && !templeIds.has(id)),
    ),
  ].sort((a, b) => a - b);

  write("regions.json", regions);
  write("cities.json", cities);
  write("temples.json", temples);
  write("alwars.json", alwars);
  write("alwar_temple_map.json", links);
  write("songbook.json", songbook);
  write("song_index.json", songIndex);
  write("songs.json", songs);

  const gaps = {
    note: "Known data gaps from the source APK; backfill in Phase 2 (harvest) or from a clean APK.",
    corruptedSongFiles: corrupted,
    anomalousAlwarLinks: anomalies, // Alwar id 23 — not a dashboard Alwar (1..12)
    avataraSthalamTempleIdsOutside108: extendedTempleIds,
  };
  write("gaps.json", gaps);

  // ----- Report + assertions -----
  const report = {
    regions: regions.length,
    cities: cities.length,
    temples: temples.length,
    alwars: alwars.length,
    alwarTempleLinks: links.length,
    anomalousLinks: anomalies.length,
    songbookSections: songbook.length,
    songIndexEntries: songIndex.length,
    songs: songs.length,
    verses: verseCount,
    corruptedSongFiles: corrupted.length,
  };
  console.log("Counts:", JSON.stringify(report, null, 2));

  const expect: [string, number, number][] = [
    ["regions", regions.length, 7],
    ["temples", temples.length, 108],
    ["alwars", alwars.length, 12],
    ["alwarTempleLinks (valid)", links.length, 202],
  ];
  let ok = true;
  for (const [name, got, want] of expect) {
    if (got !== want) {
      console.error(`  ✗ ${name}: got ${got}, expected ${want}`);
      ok = false;
    }
  }
  if (corrupted.length) {
    console.warn(`  ⚠ ${corrupted.length} corrupted song files recorded in gaps.json: ${corrupted.join(", ")}`);
  }
  console.log(ok ? "\n✓ Extraction OK" : "\n✗ Extraction had assertion failures");
  if (!ok) process.exitCode = 1;
}

main();
