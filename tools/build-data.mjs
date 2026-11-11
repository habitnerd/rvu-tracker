// Converts CMS Physician Fee Schedule Relative Value Files (CSV) into data/rvu.json.
//
// Usage:  node tools/build-data.mjs
//
// To add a new CMS release: download the zip from
//   https://www.cms.gov/medicare/payment/fee-schedules/physician/pfs-relative-value-files
// unzip the PPRRVU*.csv into cms-source/, add an entry to SOURCES below, and re-run.
// Nothing here is typed by hand: every value in rvu.json is read from the CSV.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Oldest first. effectiveFrom is the first service date the release applies to.
export const SOURCES = [
  {
    id: 'RVU26D',
    csv: 'PPRRVU2026_Oct_nonQPP.csv',
    zip: 'rvu26d-updated-08-26-2026.zip',
    effectiveFrom: '2026-10-01',
  },
  {
    id: 'RVU27A',
    csv: 'PPRRVU2027_Jan.csv',
    zip: 'rvu27a-updated-11-10-2026.zip',
    effectiveFrom: '2027-01-01',
  },
];

// Column positions in the CMS CSV. Checked against the header on every run.
const COL = { code: 0, mod: 1, desc: 2, status: 3, work: 5, facTotal: 12, pctc: 13, glob: 14, mult: 18, bilat: 19 };
const HEADER_CHECK = {
  code: /HCPCS/, mod: /MOD/, desc: /DESCRIPTION/, status: /STATUS/, work: /WORK.*RVU/,
  facTotal: /FACILITY.*TOTAL/, pctc: /PCTC/, glob: /GLOB/, mult: /MULT/, bilat: /BILAT/,
};

export function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseRvuCsv(text) {
  const lines = text.split(/\r?\n/);
  const pre = [];
  let headerAt = -1;
  for (let i = 0; i < lines.length; i++) {
    const row = parseCsvLine(lines[i]);
    if (row[0] === 'HCPCS') { headerAt = i; pre.push(row); break; }
    pre.push(row);
  }
  if (headerAt < 0) throw new Error('No HCPCS header row found');

  // The header spans several rows; join each column top to bottom.
  const joined = [];
  for (const row of pre.slice(-5)) row.forEach((cell, c) => { joined[c] = `${joined[c] || ''} ${cell}`.trim(); });
  for (const [key, re] of Object.entries(HEADER_CHECK)) {
    if (!re.test(joined[COL[key]] || '')) {
      throw new Error(`Column ${COL[key]} should be ${key} but header reads "${joined[COL[key]]}"`);
    }
  }
  // "FACILITY TOTAL" must not be the non-facility one.
  if (/NON-FAC/.test(joined[COL.facTotal])) throw new Error('facTotal column points at NON-FACILITY TOTAL');

  const preText = pre.map((r) => r.join(' ')).join('\n');
  const title = (pre.find((r) => /Relative Value File/i.test(r.join(' '))) || []).join(' ').trim();
  const rel = /RELEASED\s+(\d{2})\/(\d{2})\/(\d{4})/.exec(preText);
  if (!rel) throw new Error('No RELEASED date found');
  const copyright = (pre.find((r) => /American Medical Association/i.test(r.join(' '))) || []).join(' ').trim();

  const rows = new Map(); // code -> { '': row, '26': row }
  for (let i = headerAt + 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const r = parseCsvLine(lines[i]);
    if (!r[COL.code]) continue;
    const mod = r[COL.mod];
    if (mod !== '' && mod !== '26') continue;
    if (!rows.has(r[COL.code])) rows.set(r[COL.code], {});
    rows.get(r[COL.code])[mod] = r;
  }
  return { title, released: `${rel[3]}-${rel[1]}-${rel[2]}`, copyright, rows };
}

const num = (s) => {
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`Not a number: "${s}"`);
  return n;
};
const ind = (s) => (/^\d+$/.test(s) ? Number(s) : s);

// One code's values from one file.
// Order: [workRVU, facilityTotalRVU, globalPeriod, multProc, bilateral, status, pctc, description, used26]
// used26 = 1 when the professional-component (-26) row supplied the RVUs, which is
// what a physician bills in a facility for codes that have a technical component.
export function rowValues(entry) {
  const r = entry['26'] || entry[''];
  return [
    num(r[COL.work]), num(r[COL.facTotal]), r[COL.glob], ind(r[COL.mult]), ind(r[COL.bilat]),
    r[COL.status], ind(r[COL.pctc]), r[COL.desc], entry['26'] ? 1 : 0,
  ];
}

export function build(sources, readCsv) {
  const files = [];
  const parsed = [];
  for (const s of sources) {
    const p = parseRvuCsv(readCsv(s.csv));
    parsed.push(p);
    files.push({
      id: s.id, csv: s.csv, zip: s.zip, effectiveFrom: s.effectiveFrom,
      title: p.title, released: p.released, copyright: p.copyright, codeCount: p.rows.size,
    });
  }
  const all = new Set();
  parsed.forEach((p) => p.rows.forEach((_, code) => all.add(code)));

  const codes = {};
  for (const code of [...all].sort()) {
    const vals = parsed.map((p) => (p.rows.has(code) ? rowValues(p.rows.get(code)) : null));
    // Keep only codes that carry a work RVU in at least one release.
    if (!vals.some((v) => v && v[0] > 0)) continue;
    // Replace a repeat of an earlier identical entry with that entry's index.
    const packed = vals.map((v, i) => {
      if (!v) return null;
      const same = vals.findIndex((o, j) => j < i && o && JSON.stringify(o) === JSON.stringify(v));
      return same >= 0 ? same : v;
    });
    codes[code] = packed;
  }
  return { generated: new Date().toISOString().slice(0, 10), files, codes };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const data = build(SOURCES, (csv) => readFileSync(join(ROOT, 'cms-source', csv), 'latin1'));
  const out = join(ROOT, 'data', 'rvu.json');
  writeFileSync(out, JSON.stringify(data));
  for (const f of data.files) console.log(`${f.id}: ${f.title} | released ${f.released} | ${f.codeCount} codes in file`);
  console.log(`Wrote ${Object.keys(data.codes).length} codes with a work RVU to ${out}`);
}
