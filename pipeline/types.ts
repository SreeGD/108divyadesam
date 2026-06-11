// Shared types for the normalized bilingual dataset.
// Source language is Tamil (`ta`); English (`en`) + Roman transliteration (`translit`)
// are filled in by the translation pipeline. `review` tracks provenance so the
// site can show — and the user can verify — machine-generated text before publish.

export type ReviewStatus = "pending" | "auto" | "verified";

/** A translatable text field: Tamil original plus optional English + transliteration. */
export interface T {
  ta: string;
  en?: string;
  translit?: string;
  review: ReviewStatus;
  /** Set when the translator was uncertain; surfaced in the review report. */
  flag?: string;
}

export interface Region {
  code: number;
  icon: string;
  name: T;
  templeCount: number;
}

export interface City {
  code: number;
  icon: string;
  name: T;
  templeCount: number;
  /** Region code this city belongs to (from city_filter.json), if known. */
  regionCode?: number;
}

export interface TempleMenuItem {
  code: string; // HISTORY | ALWAR | FESTIVAL | TIME
  caption: T;
}

export interface Temple {
  refId: number;
  regionCode: number; // sId
  cityCode: number; // lId
  name: T;
  place: T;
  lat: number;
  lng: number;
  weight: number;
  images: { thumb: ImageRef; zoom: ImageRef };
  menu: TempleMenuItem[];
}

/** An image referenced in the bundled data. `path` is the server-relative path
 *  (host stripped); `local` is where the site self-hosts it. */
export interface ImageRef {
  id: string; // e.g. "1" for temples/zoom/1.webp
  category: string; // temples | alwars | alwarsmang
  variant: string; // thumb | zoom | ""
  path: string; // /apps_v1/assets/temples/zoom/1.webp
  local: string; // /img/temples/zoom/1.webp
}

export interface Alwar {
  code: number;
  icon: string;
  name: T;
  /** Temple refId of the Alwar's avatara sthalam (birthplace), from alwar_desc. */
  avataraSthalamTempleId?: number;
  image?: ImageRef;
  /** Song sections this Alwar composed (ALWAR_SONGS rows), each pointing at a songbook entry. */
  songs: { title: T; subTitle?: T; fName?: string; code?: number }[];
}

/** Join row: which Alwar sang mangalasasanam for which temple. */
export interface AlwarTempleLink {
  alwarCode: number;
  templeRefId: number;
  weight: number;
}

export type SongBlock =
  | { type: "head"; title: T; subTitle?: T; fontSize?: number }
  | { type: "subHead"; title: T; align?: string; fontSize?: number }
  | { type: "verse"; songNum: string; text: VerseText }
  | { type: "image"; image: ImageRef | { rawUrl: string }; caption?: T };

/** A single pasuram. `ta` keeps the original (newline-joined) Tamil;
 *  `translit` is the Roman rendering; `meaning` is the English prose meaning. */
export interface VerseText {
  ta: string;
  translit?: string;
  meaning?: string;
  review: ReviewStatus;
  flag?: string;
}

export interface Song {
  id: string; // dp_1, mang_8, ...
  sourceFile: string; // dpsongs/<file>.json
  title?: T;
  subTitle?: T;
  blocks: SongBlock[];
}

/** Top-level Divya Prabandham book sections (from dp_dashboard.json). */
export interface SongbookSection {
  code: number;
  name: T;
  fName: string;
  isList: boolean;
  icon: string;
  sIndex: string; // verse range label, e.g. "1 - 12"
}

export function t(ta: string): T {
  return { ta: ta ?? "", review: "pending" };
}

export function verseText(ta: string): VerseText {
  return { ta: ta ?? "", review: "pending" };
}
