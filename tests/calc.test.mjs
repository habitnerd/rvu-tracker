import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  interpolate, scaleBenchmarks, isAscending, percentileForValue, valueAtPercentile, payEstimate,
  addDays, weekdayIndex, mondayOf, yearEnd, weeksInYear, isValidISO, computePace,
  pickFileIndex, lookupCode, codeKnown,
  creditFlags, defaultSecondaryPct, creditedWrvu, tallyTotal, wrvuPerHour, planTotals, sortRows,
} from '../js/calc.js';

const WRVU = { 10: 2696, 25: 3671, 50: 5220, 75: 6710, 90: 8738 };
const PAY = { 10: 398140, 25: 448087, 50: 501510, 75: 607667, 90: 755895 };
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

// ------------------------------------------------------------ interpolation

test('interpolate: exact points, midpoints and clamping', () => {
  const pts = [[0, 0], [10, 100], [20, 400]];
  assert.deepEqual(interpolate(pts, 0), { value: 0, clamped: null });
  assert.deepEqual(interpolate(pts, 10), { value: 100, clamped: null });
  assert.deepEqual(interpolate(pts, 5), { value: 50, clamped: null });
  assert.deepEqual(interpolate(pts, 15), { value: 250, clamped: null });
  assert.deepEqual(interpolate(pts, -1), { value: 0, clamped: 'below' });
  assert.deepEqual(interpolate(pts, 21), { value: 400, clamped: 'above' });
});

test('interpolate: repeated x does not divide by zero', () => {
  const r = interpolate([[0, 0], [5, 10], [5, 20], [10, 30]], 5);
  assert.ok(Number.isFinite(r.value));
});

test('scaleBenchmarks multiplies every point by FTE', () => {
  const s = scaleBenchmarks(WRVU, 0.9);
  near(s[10], 2426.4);
  near(s[50], 4698);
  near(s[90], 7864.2);
  assert.deepEqual(scaleBenchmarks(WRVU, 1), WRVU);
});

test('isAscending catches a table that is out of order', () => {
  assert.equal(isAscending(WRVU), true);
  assert.equal(isAscending({ ...WRVU, 50: 9000 }), false);
  assert.equal(isAscending({ ...WRVU, 25: 2696 }), false);
});

test('percentileForValue: benchmark points map to their percentile', () => {
  for (const p of [10, 25, 50, 75, 90]) near(percentileForValue(WRVU, WRVU[p]).pct, p);
});

test('percentileForValue: interpolates between points', () => {
  // Halfway between 50th (5,220) and 75th (6,710) is 5,965 -> 62.5
  near(percentileForValue(WRVU, 5965).pct, 62.5);
  // One third of the way from 75th to 90th: 6,710 + 676 = 7,386 -> 80
  near(percentileForValue(WRVU, 7386).pct, 80);
  // 10th..25th: 2,696 + 0.4 * 975 = 3,086 -> 16
  near(percentileForValue(WRVU, 3086).pct, 16);
});

test('percentileForValue: clamps and labels outside 10th..90th', () => {
  assert.deepEqual(percentileForValue(WRVU, 1000), { pct: 10, clamped: 'below' });
  assert.deepEqual(percentileForValue(WRVU, 12000), { pct: 90, clamped: 'above' });
  assert.equal(percentileForValue(WRVU, 2696).clamped, null);
  assert.equal(percentileForValue(WRVU, 8738).clamped, null);
});

test('percentileForValue on FTE-scaled table: 7,864.2 at 0.9 FTE is the 90th', () => {
  near(percentileForValue(scaleBenchmarks(WRVU, 0.9), 7864.2).pct, 90);
  // The default annual target of 7,864 sits a hair under the scaled 90th.
  const r = percentileForValue(scaleBenchmarks(WRVU, 0.9), 7864);
  assert.ok(r.pct > 89.99 && r.pct < 90);
});

test('valueAtPercentile: points, interpolation and clamping', () => {
  near(valueAtPercentile(PAY, 50).value, 501510);
  // 80th: 607,667 + (5/15) * (755,895 - 607,667)
  near(valueAtPercentile(PAY, 80).value, 607667 + 148228 / 3, 1e-6);
  near(valueAtPercentile(PAY, 17.5).value, (398140 + 448087) / 2);
  assert.deepEqual(valueAtPercentile(PAY, 5), { value: 398140, clamped: 'below' });
  assert.deepEqual(valueAtPercentile(PAY, 95), { value: 755895, clamped: 'above' });
});

test('percentileForValue and valueAtPercentile are inverses inside the table', () => {
  for (const pct of [10, 12, 33.3, 50, 61, 75, 89, 90]) {
    near(percentileForValue(WRVU, valueAtPercentile(WRVU, pct).value).pct, pct, 1e-9);
  }
});

// ------------------------------------------------------------ pay estimate

test('payEstimate: 90th percentile wRVUs at 0.9 FTE -> 80th percentile pay x 0.9', () => {
  const e = payEstimate({ annualWrvu: 7864.2, fte: 0.9, wrvuBench: WRVU, payBench: PAY, pctOffset: 10 });
  near(e.wrvuPct, 90);
  near(e.payPctRaw, 80);
  near(e.fullTimePay, 657076.3333, 1e-3);
  near(e.pay, 591368.7, 1e-3);
  assert.equal(e.wrvuClamped, null);
  assert.equal(e.payClamped, null);
});

test('payEstimate: median wRVUs at 1.0 FTE -> 40th percentile pay', () => {
  const e = payEstimate({ annualWrvu: 5220, fte: 1, wrvuBench: WRVU, payBench: PAY, pctOffset: 10 });
  near(e.wrvuPct, 50);
  near(e.payPct, 40);
  // 40th: 448,087 + (15/25) * (501,510 - 448,087)
  near(e.pay, 448087 + 0.6 * 53423, 1e-6);
});

test('payEstimate: FTE scales both the wRVU table and the pay', () => {
  const full = payEstimate({ annualWrvu: 6710, fte: 1, wrvuBench: WRVU, payBench: PAY, pctOffset: 10 });
  const half = payEstimate({ annualWrvu: 3355, fte: 0.5, wrvuBench: WRVU, payBench: PAY, pctOffset: 10 });
  near(full.wrvuPct, 75);
  near(half.wrvuPct, 75);
  near(half.pay, full.pay / 2);
});

test('payEstimate: offset is configurable', () => {
  const zero = payEstimate({ annualWrvu: 5220, fte: 1, wrvuBench: WRVU, payBench: PAY, pctOffset: 0 });
  near(zero.pay, 501510);
  const five = payEstimate({ annualWrvu: 5220, fte: 1, wrvuBench: WRVU, payBench: PAY, pctOffset: 5 });
  near(five.payPct, 45);
});

test('payEstimate: pay percentile below the 10th clamps to 10th-percentile pay and says so', () => {
  // 16th percentile wRVUs -> 6th percentile pay -> clamped
  const e = payEstimate({ annualWrvu: 3086, fte: 1, wrvuBench: WRVU, payBench: PAY, pctOffset: 10 });
  near(e.payPctRaw, 6);
  assert.equal(e.payPct, 10);
  assert.equal(e.payClamped, 'below');
  near(e.pay, 398140);
});

test('payEstimate: wRVUs above the 90th clamp at 90th, so pay is at the 80th', () => {
  const e = payEstimate({ annualWrvu: 20000, fte: 0.9, wrvuBench: WRVU, payBench: PAY, pctOffset: 10 });
  assert.equal(e.wrvuClamped, 'above');
  near(e.payPct, 80);
  near(e.pay, 591368.7, 1e-3);
});

test('payEstimate: returns null without a usable pace or FTE', () => {
  assert.equal(payEstimate({ annualWrvu: null, fte: 0.9, wrvuBench: WRVU, payBench: PAY, pctOffset: 10 }), null);
  assert.equal(payEstimate({ annualWrvu: 5000, fte: 0, wrvuBench: WRVU, payBench: PAY, pctOffset: 10 }), null);
});

// ------------------------------------------------------------ dates

test('date helpers', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2027-03-01', -1), '2027-02-28');
  assert.equal(weekdayIndex('2026-11-09'), 0); // Monday
  assert.equal(weekdayIndex('2026-11-11'), 2); // Wednesday
  assert.equal(weekdayIndex('2026-11-15'), 6); // Sunday
  assert.equal(mondayOf('2026-11-11'), '2026-11-09');
  assert.equal(mondayOf('2026-11-09'), '2026-11-09');
  assert.equal(mondayOf('2026-11-15'), '2026-11-09');
  assert.equal(mondayOf('2027-01-01'), '2026-12-28');
  assert.equal(yearEnd('2026-10-01'), '2027-10-01');
  assert.equal(isValidISO('2026-02-30'), false);
  assert.equal(isValidISO('2026-10-01'), true);
  assert.equal(isValidISO('10/01/2026'), false);
});

test('mondayOf is stable across daylight-saving changes', () => {
  assert.equal(mondayOf('2026-11-01'), '2026-10-26'); // US clocks change Nov 1, 2026
  assert.equal(mondayOf('2027-03-14'), '2027-03-08'); // and Mar 14, 2027
  assert.equal(addDays('2026-10-26', 7), '2026-11-02');
});

test('weeksInYear: Oct 1, 2026 start gives 52 Mondays, Oct 5 to Sep 27', () => {
  const w = weeksInYear('2026-10-01');
  assert.equal(w.length, 52);
  assert.equal(w[0], '2026-10-05');
  assert.equal(w[51], '2027-09-27');
  assert.ok(w.every((m) => weekdayIndex(m) === 0));
});

test('weeksInYear: a Monday start includes that Monday; consecutive years do not overlap', () => {
  const w = weeksInYear('2026-10-05');
  assert.equal(w[0], '2026-10-05');
  const a = weeksInYear('2026-10-01');
  const b = weeksInYear('2027-10-01');
  assert.equal(b[0], addDays(a[a.length - 1], 7));
});

// ------------------------------------------------------------ pace

const BASE = { yearStart: '2026-10-01', annualTarget: 7864, workingWeeks: 46, weeksOff: [] };

test('computePace: mid-week in November with nothing marked off', () => {
  // Wed Nov 11, 2026. Completed weeks: Oct 5, 12, 19, 26, Nov 2 = 5. Current week 3/5 done.
  const p = computePace({ ...BASE, today: '2026-11-11', ytd: 840 });
  assert.equal(p.weeksInYear, 52);
  assert.equal(p.currentWeek, '2026-11-09');
  near(p.workedWeeks, 5.6);
  assert.equal(p.offAllowance, 6);
  assert.equal(p.unplacedOff, 6);
  // 46 future weeks + 0.4 of this week - 6 unplaced off-weeks
  near(p.remainingWorkingWeeks, 40.4);
  near(p.workedWeeks + p.remainingWorkingWeeks, 46);
  near(p.avgPerWeek, 150);
  near(p.requiredPerWeek, (7864 - 840) / 40.4);
  near(p.projectedAnnual, 840 + 150 * 40.4);
  near(p.weeklyTarget, 7864 / 46);
  assert.equal(p.notStarted, false);
  assert.equal(p.yearOver, false);
});

test('computePace: on target pace projects to exactly the annual target', () => {
  const weekly = 7864 / 46;
  const p = computePace({ ...BASE, today: '2026-11-11', ytd: weekly * 5.6 });
  near(p.projectedAnnual, 7864, 1e-6);
  near(p.requiredPerWeek, weekly, 1e-9);
});

test('computePace: marking a future week off within the allowance just places it', () => {
  const none = computePace({ ...BASE, today: '2026-11-11', ytd: 840 });
  const one = computePace({ ...BASE, today: '2026-11-11', ytd: 840, weeksOff: ['2026-12-21'] });
  assert.equal(one.offPlaced, 1);
  assert.equal(one.unplacedOff, 5);
  near(one.remainingWorkingWeeks, none.remainingWorkingWeeks);
  near(one.requiredPerWeek, none.requiredPerWeek);
});

test('computePace: marking more weeks off than the allowance raises the required pace', () => {
  const off = ['2026-11-23', '2026-12-21', '2026-12-28', '2027-02-15', '2027-03-22', '2027-06-28', '2027-07-05', '2027-08-09'];
  const p = computePace({ ...BASE, today: '2026-11-11', ytd: 840, weeksOff: off });
  assert.equal(p.offPlaced, 8);
  assert.equal(p.unplacedOff, 0);
  near(p.remainingWorkingWeeks, 46 - 8 + 0.4);
  const none = computePace({ ...BASE, today: '2026-11-11', ytd: 840 });
  assert.ok(p.requiredPerWeek > none.requiredPerWeek);
});

test('computePace: a past week marked off is not counted as worked', () => {
  const p = computePace({ ...BASE, today: '2026-11-11', ytd: 840, weeksOff: ['2026-10-19'] });
  near(p.workedWeeks, 4.6);
  near(p.avgPerWeek, 840 / 4.6);
  assert.equal(p.unplacedOff, 5);
  near(p.remainingWorkingWeeks, 46 + 0.4 - 5);
});

test('computePace: current week marked off counts as neither worked nor remaining', () => {
  const p = computePace({ ...BASE, today: '2026-11-11', ytd: 840, weeksOff: ['2026-11-09'] });
  near(p.workedWeeks, 5);
  near(p.remainingWorkingWeeks, 46 - 5);
});

test('computePace: weeks off outside the measurement year are ignored', () => {
  const p = computePace({ ...BASE, today: '2026-11-11', ytd: 840, weeksOff: ['2025-12-22', '2027-10-04'] });
  assert.equal(p.offPlaced, 0);
});

test('computePace: Monday counts one weekday done, weekend counts the week as done', () => {
  near(computePace({ ...BASE, today: '2026-11-09', ytd: 0 }).workedWeeks, 5.2);
  near(computePace({ ...BASE, today: '2026-11-13', ytd: 0 }).workedWeeks, 6);
  near(computePace({ ...BASE, today: '2026-11-15', ytd: 0 }).workedWeeks, 6);
});

test('computePace: target already met needs zero per week', () => {
  const p = computePace({ ...BASE, today: '2027-06-02', ytd: 8000 });
  assert.equal(p.remainingWrvu, 0);
  assert.equal(p.requiredPerWeek, 0);
});

test('computePace: before the year starts and after it ends', () => {
  const before = computePace({ ...BASE, today: '2026-09-15', ytd: 0 });
  assert.equal(before.notStarted, true);
  assert.equal(before.workedWeeks, 0);
  assert.equal(before.avgPerWeek, null);
  assert.equal(before.projectedAnnual, null);
  near(before.remainingWorkingWeeks, 46);
  near(before.requiredPerWeek, 7864 / 46);

  const after = computePace({ ...BASE, today: '2027-10-06', ytd: 7000 });
  assert.equal(after.yearOver, true);
  assert.equal(after.remainingWorkingWeeks, 0);
  assert.equal(after.requiredPerWeek, null);
  near(after.projectedAnnual, 7000);
});

test('computePace: unplaced off-weeks never push remaining weeks below zero', () => {
  // Late September with no weeks marked: 6 unplaced off-weeks but only 1 future week.
  const p = computePace({ ...BASE, today: '2027-09-22', ytd: 7000 });
  assert.equal(p.unplacedOff, 1);
  near(p.remainingWorkingWeeks, 0.4);
  assert.ok(p.requiredPerWeek > 0);
});

// ------------------------------------------------------------ data lookup

const DATA = {
  files: [
    { id: 'RVU26D', effectiveFrom: '2026-10-01' },
    { id: 'RVU27A', effectiveFrom: '2027-01-01' },
  ],
  codes: {
    11111: [[1.5, 2.5, '000', 2, 1, 'A', 0, 'Changed code', 0], [1.2, 2.0, '000', 2, 1, 'A', 0, 'Changed code new', 0]],
    22222: [[0.59, 0.85, 'ZZZ', 0, 0, 'A', 1, 'Same in both', 1], 0],
    33333: [[0.33, 0.43, 'ZZZ', 0, 0, 'A', 0, 'Dropped next year', 0], null],
    44444: [null, [2.0, 3.0, '010', 2, 2, 'A', 0, 'New next year', 0]],
  },
};

test('pickFileIndex: switches release on the effective date', () => {
  assert.equal(pickFileIndex(DATA.files, '2026-11-09', 'auto'), 0);
  assert.equal(pickFileIndex(DATA.files, '2026-12-28', 'auto'), 0);
  assert.equal(pickFileIndex(DATA.files, '2027-01-01', 'auto'), 1);
  assert.equal(pickFileIndex(DATA.files, '2027-01-04', 'auto'), 1);
  assert.equal(pickFileIndex(DATA.files, '2025-01-01', 'auto'), 0);
});

test('pickFileIndex: an override wins; an unknown override falls back to the date', () => {
  assert.equal(pickFileIndex(DATA.files, '2026-11-09', 'RVU27A'), 1);
  assert.equal(pickFileIndex(DATA.files, '2027-06-01', 'RVU26D'), 0);
  assert.equal(pickFileIndex(DATA.files, '2027-06-01', 'RVU99Z'), 1);
});

test('lookupCode: per-release values, shared entries, and missing codes', () => {
  assert.equal(lookupCode(DATA, '11111', 0).work, 1.5);
  assert.equal(lookupCode(DATA, '11111', 1).work, 1.2);
  assert.equal(lookupCode(DATA, '11111', 1).desc, 'Changed code new');
  const same = lookupCode(DATA, '22222', 1);
  assert.equal(same.work, 0.59);
  assert.equal(same.facTotal, 0.85);
  assert.equal(same.used26, true);
  assert.equal(lookupCode(DATA, '33333', 0).work, 0.33);
  assert.equal(lookupCode(DATA, '33333', 1), null);
  assert.equal(lookupCode(DATA, '44444', 0), null);
  assert.equal(lookupCode(DATA, '99999', 0), null);
  assert.equal(codeKnown(DATA, '33333'), true);
  assert.equal(codeKnown(DATA, '99999'), false);
  assert.equal(codeKnown(DATA, 'toString'), false);
});

// ------------------------------------------------------------ credit rules

test('creditFlags: add-on comes from global period ZZZ', () => {
  assert.equal(creditFlags({ glob: 'ZZZ', mult: 0, bilat: 1 }).addOn, true);
  assert.equal(creditFlags({ glob: '000', mult: 2, bilat: 1 }).addOn, false);
  assert.equal(creditFlags({ glob: 'XXX', mult: 0, bilat: 0 }).addOn, false);
});

test('creditFlags: MPPR is indicator 2 or 3 only', () => {
  assert.equal(creditFlags({ glob: '000', mult: 2, bilat: 9 }).mppr, true);
  assert.equal(creditFlags({ glob: '000', mult: 3, bilat: 0 }).mppr, true);
  for (const mult of [0, 4, 5, 6, 7, 9]) assert.equal(creditFlags({ glob: 'XXX', mult, bilat: 0 }).mppr, false);
});

test('creditFlags: bilateral 150% applies only to indicator 1', () => {
  assert.equal(creditFlags({ glob: '000', mult: 2, bilat: 1 }).bilateral150, true);
  for (const bilat of [0, 2, 3, 9]) assert.equal(creditFlags({ glob: '000', mult: 2, bilat }).bilateral150, false);
});

test('defaultSecondaryPct: 50 for MPPR codes, 100 for add-ons and everything else', () => {
  assert.equal(defaultSecondaryPct({ glob: '000', mult: 2, bilat: 1 }), 50);
  assert.equal(defaultSecondaryPct({ glob: 'ZZZ', mult: 0, bilat: 1 }), 100);
  assert.equal(defaultSecondaryPct({ glob: 'XXX', mult: 0, bilat: 0 }), 100);
});

test('creditedWrvu: primary at full value, secondary at the credited percent', () => {
  near(creditedWrvu(1.76, 3, 0, 50), 5.28);
  near(creditedWrvu(1.76, 0, 2, 50), 1.76);
  near(creditedWrvu(1.76, 3, 2, 50), 7.04);
  near(creditedWrvu(1.76, 3, 2, 100), 8.8);
  near(creditedWrvu(1.76, 1, 1, 0), 1.76);
  near(creditedWrvu(1.76, undefined, undefined, 50), 0);
});

test('tallyTotal: sums credited wRVUs and skips codes with no value', () => {
  const work = { 62323: 1.76, 64483: 1.85, 64484: 0.98 };
  const pct = { 62323: 50, 64483: 50, 64484: 100 };
  const counts = {
    62323: { p: 4, s: 0 },
    64483: { p: 2, s: 1 },
    64484: { p: 0, s: 3 },
    G2211: { p: 5, s: 0 }, // not in the active release
  };
  const total = tallyTotal(counts, (c) => work[c] ?? null, (c) => pct[c] ?? 100);
  near(total, 4 * 1.76 + 2 * 1.85 + 0.5 * 1.85 + 3 * 0.98);
  assert.equal(tallyTotal({}, () => 1, () => 100), 0);
  assert.equal(tallyTotal(undefined, () => 1, () => 100), 0);
});

test('wrvuPerHour', () => {
  near(wrvuPerHour(1.76, 20), 5.28);
  near(wrvuPerHour(1.92, 30), 3.84);
  assert.equal(wrvuPerHour(1.76, 0), null);
  assert.equal(wrvuPerHour(1.76, null), null);
});

// ------------------------------------------------------------ planner

test('planTotals: wRVUs, minutes, wRVU per hour and secondary credit', () => {
  const codes = {
    62323: { work: 1.76, minutes: 20, secPct: 50 },
    64483: { work: 1.85, minutes: 25, secPct: 50 },
    99214: { work: 1.92, minutes: 30, secPct: 100 },
  };
  const t = planTotals([
    { code: '62323', count: 4, sec: false },
    { code: '64483', count: 2, sec: true },
    { code: '99214', count: 3, sec: false },
  ], (c) => codes[c] || null);
  near(t.wrvu, 4 * 1.76 + 2 * 1.85 * 0.5 + 3 * 1.92);
  assert.equal(t.minutes, 4 * 20 + 2 * 25 + 3 * 30);
  near(t.perHour, (t.wrvu * 60) / 220);
  assert.deepEqual(t.missingMinutes, []);
});

test('planTotals: reports codes with no minutes and ignores unknown codes and zero counts', () => {
  const codes = { 62323: { work: 1.76, minutes: null, secPct: 50 }, 99213: { work: 1.3, minutes: 20, secPct: 100 } };
  const t = planTotals([
    { code: '62323', count: 2, sec: false },
    { code: '62323', count: 1, sec: false },
    { code: '99213', count: 0, sec: false },
    { code: '00000', count: 5, sec: false },
  ], (c) => codes[c] || null);
  near(t.wrvu, 3 * 1.76);
  assert.equal(t.minutes, 0);
  assert.equal(t.perHour, null);
  assert.deepEqual(t.missingMinutes, ['62323']);
  assert.deepEqual(planTotals([], () => null), { wrvu: 0, minutes: 0, perHour: null, missingMinutes: [] });
});

// ------------------------------------------------------------ sorting

test('sortRows: descending by default key, nulls last in both directions', () => {
  const rows = [
    { code: 'A', perHour: 3 }, { code: 'B', perHour: null }, { code: 'C', perHour: 7 }, { code: 'D', perHour: 5 },
  ];
  assert.deepEqual(sortRows(rows, 'perHour', 'desc').map((r) => r.code), ['C', 'D', 'A', 'B']);
  assert.deepEqual(sortRows(rows, 'perHour', 'asc').map((r) => r.code), ['A', 'D', 'C', 'B']);
  assert.deepEqual(sortRows(rows, 'code', 'asc').map((r) => r.code), ['A', 'B', 'C', 'D']);
  assert.equal(rows[0].code, 'A'); // input untouched
});
