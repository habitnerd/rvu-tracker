// Checks the bundled data/rvu.json against the raw CMS CSVs in cms-source/.
// The comparison reads the CSV with its own minimal parser, independent of tools/build-data.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { lookupCode, pickFileIndex, creditFlags } from '../js/calc.js';
import { STARTER_CODES } from '../js/state.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(join(ROOT, 'data', 'rvu.json'), 'utf8'));

test('bundle lists its source files with release dates', () => {
  assert.ok(data.files.length >= 1);
  for (const f of data.files) {
    assert.match(f.released, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(f.effectiveFrom, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(f.title, /Relative Value File/);
    assert.match(f.csv, /^PPRRVU.*\.csv$/);
  }
  const sorted = [...data.files].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
  assert.deepEqual(data.files, sorted);
});

test('every starter code is in every bundled release with a work RVU', () => {
  for (const code of STARTER_CODES) {
    data.files.forEach((f, i) => {
      const info = lookupCode(data, code, i);
      assert.ok(info, `${code} missing from ${f.id}`);
      assert.ok(info.work > 0, `${code} has no work RVU in ${f.id}`);
    });
  }
});

test('add-on flag lands on the expected starter codes', () => {
  const i = pickFileIndex(data.files, '2026-11-11', 'auto');
  const addOns = STARTER_CODES.filter((c) => creditFlags(lookupCode(data, c, i)).addOn);
  assert.deepEqual(addOns, ['64480', '64484', '64491', '64492', '64494', '64495', '64634', '64636']);
});

for (const f of data.files) {
  const path = join(ROOT, 'cms-source', f.csv);
  test(`bundled values equal the raw rows in ${f.csv}`, { skip: !existsSync(path) && 'cms-source CSV not present' }, () => {
    // Raw rows keyed by code; prefer the -26 row when the code has one.
    const raw = new Map();
    for (const line of readFileSync(path, 'latin1').split(/\r?\n/)) {
      // Some descriptions are quoted because they contain a comma ("inf<1,500 gm").
      const r = (line.match(/("([^"]|"")*"|[^,]*)(,|$)/g) || [])
        .map((cell) => cell.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));
      if (r.length < 20 || !/^[A-Z0-9]{5}$/.test(r[0])) continue;
      if (r[1] === '26' || (r[1] === '' && !raw.has(r[0]))) raw.set(r[0], r);
    }
    const idx = data.files.indexOf(f);
    let checked = 0;
    for (const code of Object.keys(data.codes)) {
      const info = lookupCode(data, code, idx);
      const r = raw.get(code);
      if (!info) { assert.equal(r, undefined, `${code} is in ${f.csv} but not in the bundle for ${f.id}`); continue; }
      assert.ok(r, `${code} is in the bundle for ${f.id} but not in ${f.csv}`);
      assert.equal(info.work, Number(r[5]), `${code} work RVU`);
      assert.equal(info.facTotal, Number(r[12]), `${code} facility total`);
      assert.equal(info.glob, r[14], `${code} global`);
      assert.equal(String(info.mult), String(Number(r[18])), `${code} mult proc`);
      assert.equal(String(info.bilat), String(Number(r[19])), `${code} bilateral`);
      assert.equal(info.status, r[3], `${code} status`);
      assert.equal(info.desc, r[2].trim(), `${code} description`);
      checked++;
    }
    assert.ok(checked > 7000, `only ${checked} codes checked`);
  });
}
