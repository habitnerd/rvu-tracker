import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, normalizeState, isCode, STARTER_CODES, DEFAULT_SETTINGS } from '../js/state.js';

test('defaults match the brief', () => {
  const s = defaultState();
  assert.equal(s.settings.fte, 0.9);
  assert.equal(s.settings.annualTarget, 7864);
  assert.equal(s.settings.workingWeeks, 46);
  assert.equal(s.settings.pctOffset, 10);
  assert.deepEqual(s.settings.wrvuBench, { 10: 2696, 25: 3671, 50: 5220, 75: 6710, 90: 8738 });
  assert.deepEqual(s.settings.payBench, { 10: 398140, 25: 448087, 50: 501510, 75: 607667, 90: 755895 });
  assert.equal(s.codes.length, STARTER_CODES.length);
  assert.equal(new Set(STARTER_CODES).size, STARTER_CODES.length);
});

test('normalizeState: junk becomes defaults', () => {
  for (const junk of [null, undefined, 'x', 42, [], { settings: 'no' }]) {
    assert.deepEqual(normalizeState(junk), defaultState());
  }
});

test('normalizeState: a state survives a JSON round trip unchanged', () => {
  const s = defaultState();
  s.settings.fte = 0.8;
  s.settings.wrvuBench[50] = 5300;
  s.codes[0].minutes = 20;
  s.codes[1].secPct = 100;
  s.tally['2026-11-09'] = { 62323: { p: 4, s: 1 } };
  s.weeksOff = ['2026-12-21'];
  s.planner.A = [{ code: '62323', count: 4, sec: false }];
  assert.deepEqual(normalizeState(JSON.parse(JSON.stringify(s))), s);
});

test('normalizeState: bad settings fall back, good ones are kept', () => {
  const s = normalizeState({ settings: { fte: -1, annualTarget: 'abc', workingWeeks: 60, yearStart: '2026-13-01', pctOffset: 5 } });
  assert.equal(s.settings.fte, DEFAULT_SETTINGS.fte);
  assert.equal(s.settings.annualTarget, DEFAULT_SETTINGS.annualTarget);
  assert.equal(s.settings.workingWeeks, DEFAULT_SETTINGS.workingWeeks);
  assert.equal(s.settings.yearStart, DEFAULT_SETTINGS.yearStart);
  assert.equal(s.settings.pctOffset, 5);
});

test('normalizeState: drops anything that is not a code and a count', () => {
  const s = normalizeState({
    codes: [
      { code: '62323', minutes: 20, secPct: 50, note: 'free text is dropped' },
      { code: '62323', minutes: 99 },
      { code: '<img>' },
      { code: 'g2211' },
      'junk',
    ],
    tally: {
      '2026-11-09': { 62323: { p: 2, s: 1, patient: 'x' }, 'bad code': { p: 1 }, 64483: { p: -3, s: 0 } },
      '2026-11-10': { 62323: { p: 1 } },
      nonsense: { 62323: { p: 1 } },
    },
    weeksOff: ['2026-12-21', '2026-12-21', '2026-12-22', 'x'],
    planner: { A: [{ code: '62323', count: 3, sec: 'yes', label: 'x' }, { code: 'nope' }], B: 'x' },
    extra: 'dropped',
  });
  assert.deepEqual(s.codes, [{ code: '62323', minutes: 20, secPct: 50 }]);
  assert.deepEqual(s.tally, { '2026-11-09': { 62323: { p: 2, s: 1 } } });
  assert.deepEqual(s.weeksOff, ['2026-12-21']);
  assert.deepEqual(s.planner, { A: [{ code: '62323', count: 3, sec: false }], B: [] });
  assert.equal('extra' in s, false);
});

test('isCode', () => {
  assert.equal(isCode('62323'), true);
  assert.equal(isCode('G2211'), true);
  assert.equal(isCode('0213T'), true);
  assert.equal(isCode('6232'), false);
  assert.equal(isCode('62323 '), false);
  assert.equal(isCode(62323), false);
});
