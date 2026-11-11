// Pure calculations for RVU Tracker. No DOM, no storage, so everything here is unit-tested.

export const PCTS = [10, 25, 50, 75, 90];

// ---------------------------------------------------------------- interpolation

// points: [[x, y], ...] sorted by x ascending. Linear between points, clamped at the ends.
// Returns { value, clamped } where clamped is 'below', 'above' or null.
export function interpolate(points, x) {
  const first = points[0];
  const last = points[points.length - 1];
  if (x < first[0]) return { value: first[1], clamped: 'below' };
  if (x > last[0]) return { value: last[1], clamped: 'above' };
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    if (x <= x1) {
      if (x1 === x0) return { value: y1, clamped: null };
      return { value: y0 + ((x - x0) / (x1 - x0)) * (y1 - y0), clamped: null };
    }
  }
  return { value: last[1], clamped: null };
}

// A benchmark table is { 10: n, 25: n, 50: n, 75: n, 90: n }.
export function scaleBenchmarks(bench, fte) {
  const out = {};
  for (const p of PCTS) out[p] = bench[p] * fte;
  return out;
}

export function isAscending(bench) {
  return PCTS.every((p, i) => i === 0 || bench[p] > bench[PCTS[i - 1]]);
}

// Which percentile does this value sit at? Clamped to 10th..90th.
export function percentileForValue(bench, value) {
  const r = interpolate(PCTS.map((p) => [bench[p], p]), value);
  return { pct: r.value, clamped: r.clamped };
}

// What is the benchmark value at this percentile? Clamped to 10th..90th.
export function valueAtPercentile(bench, pct) {
  return interpolate(PCTS.map((p) => [p, bench[p]]), pct);
}

// ---------------------------------------------------------------- pay estimate

// wRVU percentile is read off the FTE-scaled wRVU table. Pay percentile is that
// minus pctOffset. Pay is the full-time pay at the pay percentile, times FTE.
export function payEstimate({ annualWrvu, fte, wrvuBench, payBench, pctOffset }) {
  if (!(fte > 0) || annualWrvu == null || !Number.isFinite(annualWrvu)) return null;
  const w = percentileForValue(scaleBenchmarks(wrvuBench, fte), annualWrvu);
  const payPctRaw = w.pct - pctOffset;
  const p = valueAtPercentile(payBench, payPctRaw);
  return {
    wrvuPct: w.pct,
    wrvuClamped: w.clamped,
    payPctRaw,
    payPct: Math.min(90, Math.max(10, payPctRaw)),
    payClamped: p.clamped,
    fullTimePay: p.value,
    pay: p.value * fte,
  };
}

// ---------------------------------------------------------------- dates
// Dates are 'YYYY-MM-DD' strings. Arithmetic is done in UTC so daylight saving never shifts a day.

const DAY = 86400000;

export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function toISO(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function isValidISO(iso) {
  return typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso) && toISO(parseISO(iso)) === iso;
}

export function addDays(iso, n) {
  return toISO(parseISO(iso) + n * DAY);
}

// Monday = 0 ... Sunday = 6
export function weekdayIndex(iso) {
  return (new Date(parseISO(iso)).getUTCDay() + 6) % 7;
}

export function mondayOf(iso) {
  return addDays(iso, -weekdayIndex(iso));
}

// First day after the measurement year (same month and day, next year).
export function yearEnd(yearStart) {
  const [y, m, d] = yearStart.split('-').map(Number);
  return toISO(Date.UTC(y + 1, m - 1, d));
}

// A week belongs to the measurement year its Monday falls in.
export function weeksInYear(yearStart) {
  const end = yearEnd(yearStart);
  const weeks = [];
  let m = mondayOf(yearStart);
  if (m < yearStart) m = addDays(m, 7);
  for (; m < end; m = addDays(m, 7)) weeks.push(m);
  return weeks;
}

// ---------------------------------------------------------------- pace

// today, yearStart: ISO dates. weeksOff: array of Monday ISO dates. ytd: wRVUs so far this year.
// The current week counts as partly worked: weekdays up to and including today are "done".
// Off-weeks the plan allows (weeks in year minus working weeks) that are not yet marked on the
// calendar are assumed to still lie ahead, so they come out of the remaining working weeks.
export function computePace({ today, yearStart, annualTarget, workingWeeks, weeksOff, ytd }) {
  const weeks = weeksInYear(yearStart);
  const end = yearEnd(yearStart);
  const inYear = new Set(weeks);
  const off = new Set((weeksOff || []).filter((w) => inYear.has(w)));
  const cur = mondayOf(today);
  const curInYear = inYear.has(cur);
  const curOff = off.has(cur);

  const completed = weeks.filter((w) => w < cur);
  const future = weeks.filter((w) => w > cur);
  const futureOpen = future.filter((w) => !off.has(w)).length;

  const curElapsed = Math.min(weekdayIndex(today) + 1, 5) / 5;
  const curWorked = curInYear && !curOff ? curElapsed : 0;
  const curLeft = curInYear && !curOff ? 1 - curElapsed : 0;

  const workedWeeks = completed.filter((w) => !off.has(w)).length + curWorked;
  const offAllowance = Math.max(0, weeks.length - workingWeeks);
  const unplacedOff = Math.min(Math.max(0, offAllowance - off.size), futureOpen);
  const remainingWorkingWeeks = Math.max(0, futureOpen + curLeft - unplacedOff);

  const remainingWrvu = Math.max(0, annualTarget - ytd);
  let requiredPerWeek;
  if (remainingWrvu === 0) requiredPerWeek = 0;
  else requiredPerWeek = remainingWorkingWeeks > 0 ? remainingWrvu / remainingWorkingWeeks : null;

  const avgPerWeek = workedWeeks > 0 ? ytd / workedWeeks : null;
  const projectedAnnual = avgPerWeek == null ? null : ytd + avgPerWeek * remainingWorkingWeeks;

  return {
    weeks,
    weeksInYear: weeks.length,
    yearEnd: end,
    notStarted: today < yearStart,
    yearOver: today >= end,
    currentWeek: cur,
    workedWeeks,
    offPlaced: off.size,
    offAllowance,
    unplacedOff,
    remainingWorkingWeeks,
    remainingWrvu,
    requiredPerWeek,
    avgPerWeek,
    projectedAnnual,
    weeklyTarget: workingWeeks > 0 ? annualTarget / workingWeeks : null,
  };
}

// ---------------------------------------------------------------- RVU data lookup

// data.files is oldest first. Picks the latest release in effect on the date,
// or the earliest release if the date is before all of them. override wins if it names a file.
export function pickFileIndex(files, dateISO, override) {
  if (override && override !== 'auto') {
    const i = files.findIndex((f) => f.id === override);
    if (i >= 0) return i;
  }
  let pick = 0;
  files.forEach((f, i) => { if (f.effectiveFrom <= dateISO) pick = i; });
  return pick;
}

// Returns the code's values in one release, or null if the code is not in that release.
export function lookupCode(data, code, fileIndex) {
  const entry = data.codes[code];
  if (!entry) return null;
  let v = entry[fileIndex];
  if (typeof v === 'number') v = entry[v];
  if (!v) return null;
  return {
    code,
    work: v[0],
    facTotal: v[1],
    glob: v[2],
    mult: v[3],
    bilat: v[4],
    status: v[5],
    pctc: v[6],
    desc: v[7],
    used26: v[8] === 1,
  };
}

// True if the code is in any bundled release.
export function codeKnown(data, code) {
  return Object.prototype.hasOwnProperty.call(data.codes, code);
}

// ---------------------------------------------------------------- credit rules

// Add-on: the CMS file has no add-on column; a global period of ZZZ marks a code that is
// always reported with another service. MPPR: multiple-procedure indicator 2 (standard
// 100/50/50 rule) or 3 (endoscopy family rule). Indicators 4-7 are imaging, therapy,
// cardiovascular and ophthalmology rules that fall mainly on the technical or
// practice-expense part, so they are shown in the code detail but not flagged here.
export function creditFlags(info) {
  return {
    addOn: info.glob === 'ZZZ',
    mppr: info.mult === 2 || info.mult === 3,
    bilateral150: info.bilat === 1,
  };
}

// Medicare's default credit for a code when it is not the highest-valued procedure.
export function defaultSecondaryPct(info) {
  return creditFlags(info).mppr ? 50 : 100;
}

// primary counts are credited in full, secondary counts at secPct percent.
export function creditedWrvu(work, primary, secondary, secPct) {
  return work * ((primary || 0) + ((secondary || 0) * secPct) / 100);
}

// counts: { code: { p, s } }. getWork(code) -> wRVU or null. getSecPct(code) -> percent.
export function tallyTotal(counts, getWork, getSecPct) {
  let total = 0;
  for (const [code, c] of Object.entries(counts || {})) {
    const work = getWork(code);
    if (work == null) continue;
    total += creditedWrvu(work, c.p, c.s, getSecPct(code));
  }
  return total;
}

export function wrvuPerHour(work, minutes) {
  return minutes > 0 ? (work * 60) / minutes : null;
}

// ---------------------------------------------------------------- half-day planner

// lines: [{ code, count, sec }]. getCode(code) -> { work, minutes, secPct } or null.
export function planTotals(lines, getCode) {
  let wrvu = 0;
  let minutes = 0;
  const missingMinutes = [];
  for (const line of lines || []) {
    const c = getCode(line.code);
    const n = line.count || 0;
    if (!c || c.work == null || n <= 0) continue;
    wrvu += line.sec ? creditedWrvu(c.work, 0, n, c.secPct) : creditedWrvu(c.work, n, 0, c.secPct);
    if (c.minutes > 0) minutes += n * c.minutes;
    else if (!missingMinutes.includes(line.code)) missingMinutes.push(line.code);
  }
  return { wrvu, minutes, perHour: wrvuPerHour(wrvu, minutes), missingMinutes };
}

// ---------------------------------------------------------------- sorting

// Sorts by a numeric or string key. Rows whose key is null always go last.
export function sortRows(rows, key, dir) {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    if (x == null && y == null) return a.code < b.code ? -1 : 1;
    if (x == null) return 1;
    if (y == null) return -1;
    if (x === y) return a.code < b.code ? -1 : 1;
    return (x < y ? -1 : 1) * sign;
  });
}
