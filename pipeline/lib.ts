import { readFileSync } from "node:fs";
import type { ImageRef } from "./types.ts";

/** Read a file as UTF-8, tolerating the stray non-UTF-8 byte found in some
 *  dpsongs files (decode with replacement rather than throwing). */
export function readTolerant(path: string): string {
  const buf = readFileSync(path);
  return new TextDecoder("utf-8", { fatal: false }).decode(buf).replace(/^﻿/, "");
}

export interface SqlRow {
  table: string;
  cols: string[];
  values: string[]; // raw token strings (quotes stripped for quoted tokens)
}

/**
 * Parse `INSERT INTO table(cols) VALUES(...);` statements.
 * Splits the VALUES list on top-level commas while respecting single-quoted
 * SQL strings (with `''` as an escaped quote). Returns each value with the
 * surrounding quotes removed and `''` collapsed to `'`.
 */
export function parseInserts(sql: string): SqlRow[] {
  const rows: SqlRow[] = [];
  const re = /INSERT\s+INTO\s+(\w+)\s*\(([^)]*)\)\s*VALUES\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    const table = m[1]!;
    const cols = m[2]!.split(",").map((c) => c.trim());
    const { values, end } = splitValues(sql, re.lastIndex);
    rows.push({ table, cols, values });
    re.lastIndex = end;
  }
  return rows;
}

/** Tokenize from `start` (just after the opening `(`) until the matching `)`. */
function splitValues(s: string, start: number): { values: string[]; end: number } {
  const values: string[] = [];
  let i = start;
  let cur = "";
  let inStr = false;
  let isQuoted = false;
  for (; i < s.length; i++) {
    const ch = s[i]!;
    if (inStr) {
      if (ch === "'") {
        if (s[i + 1] === "'") {
          cur += "'";
          i++;
        } else {
          inStr = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === "'") {
      inStr = true;
      isQuoted = true;
      continue;
    }
    if (ch === ",") {
      values.push(isQuoted ? cur : cur.trim());
      cur = "";
      isQuoted = false;
      continue;
    }
    if (ch === ")") {
      values.push(isQuoted ? cur : cur.trim());
      return { values, end: i + 1 };
    }
    cur += ch;
  }
  // Unterminated — return what we have.
  if (cur.length) values.push(isQuoted ? cur : cur.trim());
  return { values, end: i };
}

/** Build an ImageRef from a bundled URL like
 *  `http://[IMG_HOSTNAME]/apps_v1/assets/temples/zoom/1.webp`
 *  or an absolute S3/CloudFront URL. Host is stripped; site self-hosts under /img. */
export function imageRefFromUrl(url: string): ImageRef {
  // Normalize escaped slashes that may survive from JSON.
  const clean = url.replace(/\\\//g, "/");
  const m = clean.match(/\/apps_v1\/assets\/([^/]+)\/(?:([^/]+)\/)?([^/]+?)\.webp/i);
  if (m) {
    const category = m[1]!;
    const variant = m[2] ?? "";
    const id = m[3]!;
    const path = variant
      ? `/apps_v1/assets/${category}/${variant}/${id}.webp`
      : `/apps_v1/assets/${category}/${id}.webp`;
    const local = variant
      ? `/img/${category}/${variant}/${id}.webp`
      : `/img/${category}/${id}.webp`;
    return { id, category, variant, path, local };
  }
  // Fallback: keep raw as id-less ref.
  return { id: "", category: "", variant: "", path: clean, local: clean };
}
