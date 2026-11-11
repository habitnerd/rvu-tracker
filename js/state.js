// Saved state: its defaults and the cleaning applied to anything loaded or imported.
// The state holds codes and counts only. There are no free-text fields, so there is
// nowhere to put patient information.

import { PCTS, isValidISO, mondayOf } from './calc.js';

export const STATE_VERSION = 1;

export const STARTER_CODES = [
  '62321', '62323', '64479', '64480', '64483', '64484',
  '64490', '64491', '64492', '64493', '64494', '64495',
  '64633', '64634', '64635', '64636', '64615', '64616', '64400', '64405',
  '20552', '20553', '20610', '20611', '27096',
  '99202', '99203', '99204', '99205', '99211', '99212', '99213', '99214', '99215',
  '98004', '98005', '98006', '98007', '98016',
];

export const DEFAULT_SETTINGS = {
  fte: 0.9,
  annualTarget: 7864,
  workingWeeks: 46,
  yearStart: '2026-10-01',
  startingYtd: 0,
  pctOffset: 10,
  rvuFile: 'auto',
  tallySort: 'used',
  wrvuBench: { 10: 2696, 25: 3671, 50: 5220, 75: 6710, 90: 8738 },
  payBench: { 10: 398140, 25: 448087, 50: 501510, 75: 607667, 90: 755895 },
};

export function defaultState() {
  return {
    version: STATE_VERSION,
    settings: structuredClone(DEFAULT_SETTINGS),
    // secPct null means "use the Medicare default for this code".
    codes: STARTER_CODES.map((code) => ({ code, minutes: null, secPct: null })),
    tally: {},
    weeksOff: [],
    planner: { A: [], B: [] },
  };
}

export function isCode(s) {
  return typeof s === 'string' && /^[A-Z0-9]{5}$/.test(s);
}

const numIn = (v, min, max, fallback) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};
const intIn = (v, min, max, fallback) => Math.round(numIn(v, min, max, fallback));
const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);

function cleanBench(raw, fallback) {
  const out = {};
  for (const p of PCTS) out[p] = numIn(isObj(raw) ? raw[p] : undefined, 0, 1e9, fallback[p]);
  return out;
}

// Returns a valid state built from anything: a saved state, an imported backup, or junk.
// Unknown fields are dropped and bad values fall back to defaults.
export function normalizeState(raw) {
  const d = defaultState();
  if (!isObj(raw)) return d;
  const s = isObj(raw.settings) ? raw.settings : {};
  const D = DEFAULT_SETTINGS;
  const settings = {
    fte: numIn(s.fte, 0.05, 2, D.fte),
    annualTarget: numIn(s.annualTarget, 0, 1e6, D.annualTarget),
    workingWeeks: numIn(s.workingWeeks, 1, 53, D.workingWeeks),
    yearStart: isValidISO(s.yearStart) ? s.yearStart : D.yearStart,
    startingYtd: numIn(s.startingYtd, 0, 1e6, D.startingYtd),
    pctOffset: numIn(s.pctOffset, -100, 100, D.pctOffset),
    rvuFile: typeof s.rvuFile === 'string' && /^[A-Za-z0-9]{1,12}$/.test(s.rvuFile) ? s.rvuFile : D.rvuFile,
    tallySort: s.tallySort === 'code' ? 'code' : 'used',
    wrvuBench: cleanBench(s.wrvuBench, D.wrvuBench),
    payBench: cleanBench(s.payBench, D.payBench),
  };

  let codes = d.codes;
  if (Array.isArray(raw.codes)) {
    const seen = new Set();
    codes = [];
    for (const c of raw.codes) {
      if (!isObj(c) || !isCode(c.code) || seen.has(c.code)) continue;
      seen.add(c.code);
      codes.push({
        code: c.code,
        minutes: c.minutes == null ? null : numIn(c.minutes, 0.1, 1440, null),
        secPct: c.secPct == null ? null : numIn(c.secPct, 0, 200, null),
      });
    }
  }

  const tally = {};
  if (isObj(raw.tally)) {
    for (const [week, counts] of Object.entries(raw.tally)) {
      if (!isValidISO(week) || mondayOf(week) !== week || !isObj(counts)) continue;
      const clean = {};
      for (const [code, c] of Object.entries(counts)) {
        if (!isCode(code) || !isObj(c)) continue;
        const p = intIn(c.p, 0, 9999, 0);
        const sec = intIn(c.s, 0, 9999, 0);
        if (p || sec) clean[code] = { p, s: sec };
      }
      if (Object.keys(clean).length) tally[week] = clean;
    }
  }

  const weeksOff = Array.isArray(raw.weeksOff)
    ? [...new Set(raw.weeksOff.filter((w) => isValidISO(w) && mondayOf(w) === w))].sort()
    : [];

  const cleanPlan = (lines) => (Array.isArray(lines) ? lines : [])
    .filter((l) => isObj(l) && isCode(l.code))
    .slice(0, 40)
    .map((l) => ({ code: l.code, count: intIn(l.count, 0, 99, 1), sec: l.sec === true }));
  const rp = isObj(raw.planner) ? raw.planner : {};

  return {
    version: STATE_VERSION,
    settings,
    codes,
    tally,
    weeksOff,
    planner: { A: cleanPlan(rp.A), B: cleanPlan(rp.B) },
  };
}
