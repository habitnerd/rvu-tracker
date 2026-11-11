// RVU Tracker user interface. All arithmetic lives in calc.js; this file only reads
// state, calls those functions, and draws the result.

import * as C from './calc.js';
import { defaultState, normalizeState, isCode } from './state.js';

const KEY = 'rvuTracker.v1';
const $ = (sel, el = document) => el.querySelector(sel);
const view = $('#view');

let data = null;
let state = defaultState();
const ui = { tab: 'tally', week: null, sortKey: 'perHour', sortDir: 'desc', open: null, filter: '', msg: null };

// ---------------------------------------------------------------- formatting

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (dp) => new Intl.NumberFormat('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const f0 = (n) => nf(0).format(n);
const f1 = (n) => nf(1).format(n);
const f2 = (n) => nf(2).format(n);
const usd = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const dash = (n, fmt) => (n == null || !Number.isFinite(n) ? '—' : fmt(n));
const dShort = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const dLong = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const fmtDate = (iso) => dShort.format(new Date(C.parseISO(iso)));
const fmtDateLong = (iso) => dLong.format(new Date(C.parseISO(iso)));
const ordinal = (n) => {
  const r = Math.round(n);
  const t = r % 100;
  const suffix = t >= 11 && t <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][r % 10] || 'th';
  return `${r}${suffix}`;
};

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------------------------------------------------------------- storage

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = normalizeState(JSON.parse(raw));
  } catch { /* unreadable or blocked storage: start from defaults */ }
}

let saveFailed = false;
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    saveFailed = false;
  } catch {
    if (!saveFailed) toast('Could not save in this browser. Export a backup from Settings.');
    saveFailed = true;
  }
}

let toastTimer;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

// ---------------------------------------------------------------- data access

const fileIdx = (date) => C.pickFileIndex(data.files, date, state.settings.rvuFile);
const info = (code, idx) => C.lookupCode(data, code, idx);
const cfg = (code) => state.codes.find((c) => c.code === code);

// Newest release that has the code. Used for flags and labels when the active release lacks it.
function anyInfo(code) {
  for (let i = data.files.length - 1; i >= 0; i--) {
    const v = info(code, i);
    if (v) return v;
  }
  return null;
}

function secPct(code) {
  const c = cfg(code);
  if (c && c.secPct != null) return c.secPct;
  const i = anyInfo(code);
  return i ? C.defaultSecondaryPct(i) : 100;
}

function weekTotal(week) {
  const idx = fileIdx(week);
  return C.tallyTotal(state.tally[week], (code) => info(code, idx)?.work ?? null, secPct);
}

function ytd() {
  const weeks = C.weeksInYear(state.settings.yearStart);
  return state.settings.startingYtd + weeks.reduce((t, w) => t + (state.tally[w] ? weekTotal(w) : 0), 0);
}

function pace() {
  const s = state.settings;
  return C.computePace({
    today: today(), yearStart: s.yearStart, annualTarget: s.annualTarget,
    workingWeeks: s.workingWeeks, weeksOff: state.weeksOff, ytd: ytd(),
  });
}

// True when weeks of the year have gone by with nothing recorded for them: the starting
// balance is still zero and no completed week has a tally.
function needsStartingBalance(p) {
  if (state.settings.startingYtd > 0 || p.workedWeeks < 1) return false;
  return !p.weeks.some((w) => w < p.currentWeek && state.tally[w]);
}

// ---------------------------------------------------------------- shared pieces

function badges(i, code, idx) {
  if (!i) return '';
  const f = C.creditFlags(i);
  const out = [];
  if (f.addOn) out.push('<span class="badge">add-on</span>');
  if (f.mppr) out.push('<span class="badge">MPPR</span>');
  if (i.status !== 'A') out.push(`<span class="badge w">status ${esc(i.status)}</span>`);
  if (idx != null && !info(code, idx)) out.push(`<span class="badge w">not in ${esc(data.files[idx].id)}</span>`);
  return out.join('');
}

function renderHeader() {
  const w = C.mondayOf(today());
  const p = pace();
  $('#hdr-week').innerHTML = `This week <b>${f1(weekTotal(w))}</b> / ${dash(p.weeklyTarget, f0)}`;
}

function renderFooter() {
  const date = ui.tab === 'tally' ? ui.week : today();
  const active = fileIdx(date);
  const f = data.files[active];
  const others = data.files.filter((_, i) => i !== active).map((o) =>
    `${esc(o.id)} (${esc(o.csv)}, released ${fmtDateLong(o.released)}, effective ${fmtDateLong(o.effectiveFrom)})`);
  const mode = state.settings.rvuFile === 'auto' ? 'chosen by date' : 'fixed in Settings';
  $('#foot').innerHTML = `
    <p>Source: CMS Physician Fee Schedule Relative Value File <b>${esc(f.id)}</b>
      (${esc(f.csv)}), released <b>${fmtDateLong(f.released)}</b>, effective ${fmtDateLong(f.effectiveFrom)}.
      In use here, ${mode}. ${others.length ? `Also bundled: ${others.join('; ')}.` : ''}</p>
    <p>Work RVUs are read from the CMS file. Facility totals use the facility column, and the -26 row for codes with a technical component.
      Pay figures are estimates, not a statement of compensation.</p>
    <p>${esc(f.copyright)}</p>`;
}

// ---------------------------------------------------------------- tally view

function tallyCodes(week) {
  const listed = state.codes.map((c) => c.code);
  const extra = Object.keys(state.tally[week] || {}).filter((c) => !listed.includes(c));
  let codes = listed;
  if (state.settings.tallySort === 'used') {
    const used = {};
    for (const counts of Object.values(state.tally)) {
      for (const [code, c] of Object.entries(counts)) used[code] = (used[code] || 0) + c.p + c.s;
    }
    codes = listed.map((code, i) => ({ code, i, n: used[code] || 0 }))
      .sort((a, b) => b.n - a.n || a.i - b.i).map((r) => r.code);
  } else {
    codes = [...listed].sort();
  }
  return [...codes, ...extra];
}

function stepper(kind, n, code, label) {
  return `<div class="stepper">
    <button class="sbtn minus" data-act="dec" data-kind="${kind}" aria-label="Remove one ${esc(code)}${label}" ${n ? '' : 'disabled'}>−</button>
    <output>${n}</output>
    <button class="sbtn plus" data-act="inc" data-kind="${kind}" aria-label="Add one ${esc(code)}${label}">+</button>
  </div>`;
}

function tallyRowHTML(code, week) {
  const idx = fileIdx(week);
  const i = info(code, idx);
  const a = i || anyInfo(code);
  const c = (state.tally[week] || {})[code] || { p: 0, s: 0 };
  const pct = secPct(code);
  const credited = i ? C.creditedWrvu(i.work, c.p, c.s, pct) : 0;
  const desc = a ? a.desc : 'Not in the bundled CMS files';
  const hasCount = c.p > 0 || c.s > 0;
  const hide = ui.filter && !`${code} ${desc}`.toLowerCase().includes(ui.filter);
  const removed = cfg(code) ? '' : '<span class="badge w">removed from list</span>';
  return `<li class="trow${hasCount ? ' has' : ''}" data-code="${esc(code)}" data-text="${esc(`${code} ${desc}`.toLowerCase())}"${hide ? ' hidden' : ''}>
    <div class="tmain">
      <div class="tinfo">
        <div class="tcode">${esc(code)} ${badges(a, code, idx)}${removed}</div>
        <div class="tdesc">${esc(desc)}</div>
        <div class="tval">${i ? `${f2(i.work)} wRVU` : 'no wRVU in this release'}${hasCount && i ? ` · <b>${f2(credited)}</b> logged` : ''}</div>
      </div>
      ${stepper('p', c.p, code, '')}
    </div>
    ${pct !== 100 || c.s > 0 ? `<div class="tsec"><span>As 2nd · ${f0(pct)}% credit</span>${stepper('s', c.s, code, ' as second procedure')}</div>` : ''}
  </li>`;
}

function tallyHeroHTML(week) {
  const p = pace();
  const total = weekTotal(week);
  const target = p.weeklyTarget;
  const pctDone = target > 0 ? Math.min(100, (total / target) * 100) : 0;
  const left = target - total;
  const off = state.weeksOff.includes(week);
  const need = p.requiredPerWeek == null ? '' : `<span>Needed from here <b>${f1(p.requiredPerWeek)}</b>/wk</span>`;
  const hint = needsStartingBalance(p)
    ? `<p class="note">Your year began ${fmtDate(state.settings.yearStart)}. Enter the wRVUs you earned before today under Settings → Starting wRVUs so the pace is right.</p>` : '';
  return `<div class="big">${f1(total)} <small>of ${dash(target, f1)} wRVU</small></div>
    <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pctDone)}"><i style="width:${pctDone}%"></i></div>
    <div class="herorow">
      <span>${left > 0 ? `<b>${f1(left)}</b> to weekly target` : `<span class="ahead">Target met, +${f1(-left)}</span>`}${off ? ' · marked off' : ''}</span>
      ${need}
    </div>${hint}`;
}

function viewTally() {
  const week = ui.week;
  const cur = C.mondayOf(today());
  const label = `${fmtDate(week)} – ${fmtDate(C.addDays(week, 6))}`;
  const sort = state.settings.tallySort;
  return `
    <section class="weekbar">
      <button class="nav" data-act="week" data-d="-7" aria-label="Previous week">‹</button>
      <div class="weeklabel"><strong>${label}</strong>
        ${week === cur ? '<span>This week</span>' : '<button class="link" data-act="week-now">Back to this week</button>'}
      </div>
      <button class="nav" data-act="week" data-d="7" aria-label="Next week">›</button>
    </section>
    <section class="card" id="tally-hero">${tallyHeroHTML(week)}</section>
    <div class="toolbar">
      <input type="search" data-in="filter" placeholder="Filter codes" value="${esc(ui.filter)}" autocomplete="off" aria-label="Filter codes">
      <div class="seg" role="group" aria-label="Order">
        <button data-act="tsort" data-v="used" aria-pressed="${sort === 'used'}">Most used</button>
        <button data-act="tsort" data-v="code" aria-pressed="${sort === 'code'}">Code</button>
      </div>
    </div>
    <ul class="tlist">${tallyCodes(week).map((code) => tallyRowHTML(code, week)).join('')}</ul>
    <p class="note">Counts only. Tap + for each one done. "As 2nd procedure" counts are credited at the percent set for that code under Codes.</p>`;
}

function bump(code, kind, delta) {
  const week = ui.week;
  const counts = state.tally[week] || (state.tally[week] = {});
  const c = counts[code] || (counts[code] = { p: 0, s: 0 });
  c[kind] = Math.max(0, Math.min(9999, c[kind] + delta));
  if (!c.p && !c.s) delete counts[code];
  if (!Object.keys(counts).length) delete state.tally[week];
  save();
  const row = view.querySelector(`.trow[data-code="${CSS.escape(code)}"]`);
  if (row) row.outerHTML = tallyRowHTML(code, week);
  $('#tally-hero').innerHTML = tallyHeroHTML(week);
  renderHeader();
}

// ---------------------------------------------------------------- codes view

const GLOB = {
  '000': '0-day global',
  '010': '10-day global',
  '090': '90-day global',
  XXX: 'global concept does not apply',
  YYY: 'contractor sets the global period',
  ZZZ: 'always part of another service (add-on)',
  MMM: 'maternity, usual global does not apply',
};
const MULT = {
  0: 'no multiple-procedure adjustment',
  1: 'pre-1995 standard rules',
  2: 'standard rules: highest at 100%, each additional at 50%',
  3: 'endoscopy family rules',
  4: 'diagnostic imaging family rules',
  5: 'therapy: 50% of practice expense',
  6: 'cardiovascular diagnostic: technical component reduced 25%',
  7: 'ophthalmology diagnostic: technical component reduced 20%',
  9: 'concept does not apply',
};
const BILAT = {
  0: '150% bilateral adjustment does not apply',
  1: '150% bilateral adjustment applies',
  2: 'RVUs already based on a bilateral procedure',
  3: 'each side paid at 100%',
  9: 'concept does not apply',
};
const STATUS = {
  A: 'active',
  B: 'bundled into other services',
  C: 'contractor priced',
  I: 'not valid for Medicare; Medicare uses another code',
  N: 'not covered by Medicare',
  R: 'restricted coverage',
  T: 'paid only if no other fee-schedule service is billed that day',
  X: 'statutory exclusion',
};

function codeRows() {
  const idx = fileIdx(today());
  const rows = state.codes.map((c) => {
    const i = info(c.code, idx);
    return {
      code: c.code, i, a: i || anyInfo(c.code),
      work: i ? i.work : null,
      minutes: c.minutes,
      perHour: i ? C.wrvuPerHour(i.work, c.minutes) : null,
    };
  });
  return C.sortRows(rows, ui.sortKey, ui.sortDir);
}

function detailHTML(r, idx) {
  const a = r.a;
  if (!a) return '<p class="sub">This code is not in the bundled CMS files.</p><button class="btn danger" data-act="remove">Remove from my list</button>';
  const f = C.creditFlags(a);
  const c = cfg(r.code);
  const def = C.defaultSecondaryPct(a);
  const other = data.files.map((file, i) => ({ file, v: info(r.code, i) }))
    .filter((o, i) => i !== idx)
    .map((o) => `<dt>${esc(o.file.id)}</dt><dd>${o.v ? `${f2(o.v.work)} wRVU, facility total ${f2(o.v.facTotal)}` : 'not in this release'}</dd>`)
    .join('');
  const src = r.i ? data.files[idx].id : 'newest release with this code';
  return `
    <dl class="dl">
      <dt>Description</dt><dd>${esc(a.desc)}</dd>
      <dt>Work RVU</dt><dd>${f2(a.work)} <span class="sub">(${esc(src)})</span></dd>
      <dt>Facility total RVU</dt><dd>${f2(a.facTotal)}${a.used26 ? ' <span class="sub">(-26 professional component row)</span>' : ''}</dd>
      <dt>Global period</dt><dd>${esc(a.glob)} <span class="sub">${esc(GLOB[a.glob] || '')}</span></dd>
      <dt>Multiple procedure</dt><dd>${esc(a.mult)} <span class="sub">${esc(MULT[a.mult] || '')}</span></dd>
      <dt>Bilateral</dt><dd>${esc(a.bilat)} <span class="sub">${esc(BILAT[a.bilat] || '')}</span></dd>
      <dt>Add-on code</dt><dd>${f.addOn ? 'Yes' : 'No'}</dd>
      <dt>Status</dt><dd>${esc(a.status)} <span class="sub">${esc(STATUS[a.status] || '')}</span></dd>
      ${other}
    </dl>
    <div class="inline">
      <label for="sec-${esc(r.code)}">Credited as a secondary procedure at</label>
      <input id="sec-${esc(r.code)}" type="number" inputmode="decimal" min="0" max="200" step="1" data-in="secpct"
        value="${c.secPct == null ? '' : c.secPct}" placeholder="${def}">
      <span>% <span class="sub">(Medicare default ${def}%)</span></span>
    </div>
    <button class="btn danger" data-act="remove">Remove from my list</button>`;
}

function viewCodes() {
  const idx = fileIdx(today());
  const th = (key, label) => {
    const on = ui.sortKey === key;
    const arrow = on ? (ui.sortDir === 'asc' ? ' ▲' : ' ▼') : '';
    return `<th><button data-act="sort" data-k="${key}"${on ? ` aria-sort="${ui.sortDir === 'asc' ? 'ascending' : 'descending'}"` : ''}>${label}${arrow}</button></th>`;
  };
  const body = codeRows().map((r) => {
    const open = ui.open === r.code;
    return `<tr class="prow" data-code="${esc(r.code)}">
      <td><button class="rowbtn" data-act="open" aria-expanded="${open}">
        <b>${esc(r.code)} ${badges(r.a, r.code, idx)}</b><span class="d">${esc(r.a ? r.a.desc : 'Not in the bundled CMS files')}</span></button></td>
      <td>${dash(r.work, f2)}</td>
      <td><input type="number" inputmode="decimal" min="0" step="1" data-in="minutes" value="${r.minutes == null ? '' : r.minutes}" placeholder="min" aria-label="Minutes for ${esc(r.code)}"></td>
      <td class="ph">${dash(r.perHour, f2)}</td>
    </tr>${open ? `<tr class="detail" data-code="${esc(r.code)}"><td colspan="4">${detailHTML(r, idx)}</td></tr>` : ''}`;
  }).join('');
  const missing = state.codes.filter((c) => c.minutes == null).length;
  return `
    <form class="addform" data-form="add">
      <input name="code" placeholder="Add a CPT code, e.g. 64451" maxlength="5" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" aria-label="CPT code to add">
      <button class="btn" type="submit">Add</button>
    </form>
    <p class="msg${ui.msg && ui.msg.err ? ' err' : ''}" id="codes-msg" role="status">${ui.msg ? esc(ui.msg.text) : ''}</p>
    <div class="tablewrap"><table class="ptable">
      <thead><tr>${th('code', 'Code')}${th('work', 'wRVU')}${th('minutes', 'My min')}${th('perHour', 'wRVU/hr')}</tr></thead>
      <tbody>${body}</tbody>
    </table></div>
    <p class="note">${missing ? `${missing} of ${state.codes.length} codes have no minutes yet. ` : ''}Enter your own minutes per case, including room turnover. Tap a code for its CMS details, the "credited at %" field and Remove. Tap a column heading to sort.</p>`;
}

function addCode(rawCode) {
  const code = rawCode.trim().toUpperCase();
  const fail = (text) => { ui.msg = { err: true, text }; };
  if (!isCode(code)) fail('A code is 5 characters, like 64483 or G2211.');
  else if (cfg(code)) { fail(`${code} is already in your list.`); ui.open = code; }
  else if (!C.codeKnown(data, code)) fail(`${code} is not in the bundled CMS files with a work RVU. Either the code does not exist or CMS lists no work RVU for it.`);
  else {
    state.codes.push({ code, minutes: null, secPct: null });
    save();
    const idx = fileIdx(today());
    const a = anyInfo(code);
    const notes = [];
    data.files.forEach((file, i) => {
      if (info(code, i)) return;
      notes.push(i === idx ? `it is not in ${file.id}, the release in use today`
        : `it is not in ${file.id} (effective ${fmtDateLong(file.effectiveFrom)})`);
    });
    if (a.status !== 'A') notes.push(`CMS status is ${a.status} (${STATUS[a.status] || 'see CMS documentation'})`);
    ui.msg = { err: false, text: `Added ${code}, ${a.desc}, ${f2(a.work)} wRVU.${notes.length ? ` Note: ${notes.join('; ')}.` : ''}` };
    ui.open = code;
  }
  render();
  const row = view.querySelector(`.prow[data-code="${CSS.escape(code)}"]`);
  if (row) row.scrollIntoView({ block: 'center' });
}

// ---------------------------------------------------------------- pace view

function ladderHTML(p, est) {
  const s = state.settings;
  const scaled = C.scaleBenchmarks(s.wrvuBench, s.fte);
  const rungs = [...C.PCTS].reverse().map((pct) =>
    `<div class="rung" style="bottom:${pct}%"><span class="rl">${pct}th</span><span class="rv num">${f0(scaled[pct])}</span></div>`).join('');
  let you = '';
  let fill = '';
  if (est) {
    const edge = est.wrvuClamped === 'below' ? 'Below 10th' : est.wrvuClamped === 'above' ? 'Above 90th' : ordinal(est.wrvuPct);
    you = `<div class="you" style="bottom:${est.wrvuPct}%">You: ${edge} · ${f0(p.projectedAnnual)}</div>`;
    fill = `<div class="fill" style="height:${est.wrvuPct}%"></div>`;
  }
  return `<div class="ladder" role="img" aria-label="Percentile ladder">
    <div class="rail"></div>${fill}${rungs}${you}</div>`;
}

function viewPace() {
  const s = state.settings;
  const p = pace();
  const total = ytd();
  const logged = total - s.startingYtd;
  const pctTarget = s.annualTarget > 0 ? (total / s.annualTarget) * 100 : 0;
  const expected = p.weeklyTarget * p.workedWeeks;
  const gap = total - expected;
  const cur = p.currentWeek;
  const okTables = C.isAscending(s.wrvuBench) && C.isAscending(s.payBench);
  const est = okTables ? C.payEstimate({
    annualWrvu: p.projectedAnnual, fte: s.fte, wrvuBench: s.wrvuBench, payBench: s.payBench, pctOffset: s.pctOffset,
  }) : null;

  const banner = p.yearOver
    ? `<div class="warnbox">Your measurement year ended ${fmtDateLong(C.addDays(p.yearEnd, -1))}. Set the new year start date in Settings.</div>`
    : p.notStarted ? `<div class="warnbox">Your measurement year starts ${fmtDateLong(s.yearStart)}.</div>` : '';
  const startHint = needsStartingBalance(p)
    ? `<div class="warnbox">Your year began ${fmtDateLong(s.yearStart)} and no earlier weeks are logged. Enter the wRVUs you earned before today under Settings → Starting wRVUs, or the pace below will read low.</div>` : '';
  const tableWarn = okTables ? '' : '<div class="warnbox">A benchmark table in Settings is not in ascending order, so the percentile and pay estimate are hidden.</div>';

  let payHTML = '<p class="sub">Log at least part of a week, or enter starting wRVUs in Settings, to see an estimate.</p>';
  if (est) {
    const wLabel = est.wrvuClamped === 'below' ? 'below the 10th percentile, treated as the 10th'
      : est.wrvuClamped === 'above' ? 'above the 90th percentile, treated as the 90th' : `${ordinal(est.wrvuPct)} percentile`;
    const pLabel = est.payClamped === 'below' ? `${ordinal(est.payPctRaw)}, which is below the table, so 10th-percentile pay is used`
      : est.payClamped === 'above' ? `${ordinal(est.payPctRaw)}, which is above the table, so 90th-percentile pay is used` : ordinal(est.payPct);
    const sign = s.pctOffset >= 0 ? `minus ${f0(s.pctOffset)}` : `plus ${f0(-s.pctOffset)}`;
    const edge = est.wrvuClamped || est.payClamped
      ? '<p class="note">Your pace falls outside the benchmark tables, so this figure is the edge of the table rather than an interpolated value.</p>' : '';
    payHTML = `<div class="big">${usd(est.pay)}</div>
      <ol class="steps">
        <li>Projected <b>${f0(p.projectedAnnual)}</b> wRVUs at ${f2(s.fte)} FTE: <b>${wLabel}</b>.</li>
        <li>Pay percentile, that ${sign} points: <b>${pLabel}</b>.</li>
        <li>Full-time pay at that percentile: <b>${usd(est.fullTimePay)}</b>, times ${f2(s.fte)} FTE.</li>
      </ol>${edge}
      <p class="note">An estimate from your current pace and the tables in Settings. It is not a statement of what you will be paid.</p>`;
  }

  const weeks = p.weeks.map((w) => {
    const off = state.weeksOff.includes(w);
    const cls = `wk${off ? ' off' : ''}${w === cur ? ' cur' : ''}${w < cur ? ' past' : ''}`;
    const t = state.tally[w] ? weekTotal(w) : 0;
    const sub = off ? 'off' : t > 0 ? f0(t) : w < cur ? '–' : '';
    return `<button class="${cls}" data-act="weekoff" data-w="${w}" aria-pressed="${off}" aria-label="Week of ${fmtDateLong(w)}${off ? ', off' : ''}">${fmtDate(w)}<small>${sub}&nbsp;</small></button>`;
  }).join('');

  return `${banner}${startHint}${tableWarn}
    <section class="card">
      <div class="big">${f1(total)} <small>of ${f0(s.annualTarget)} wRVU this year</small></div>
      <div class="bar"><i style="width:${Math.min(100, pctTarget)}%"></i></div>
      <div class="herorow">
        <span><b>${f1(pctTarget)}%</b> of target</span>
        <span class="${gap >= 0 ? 'ahead' : 'behind'}">${gap >= 0 ? `${f1(gap)} ahead of` : `${f1(-gap)} behind`} target pace</span>
      </div>
      <p class="note">${f1(logged)} logged here${s.startingYtd ? ` plus ${f1(s.startingYtd)} starting balance` : ''}. Year ${fmtDateLong(s.yearStart)} to ${fmtDateLong(C.addDays(p.yearEnd, -1))}.</p>
    </section>
    <section class="grid2">
      <div class="stat"><div class="k">Average per worked week</div><div class="v num">${dash(p.avgPerWeek, f1)}</div><div class="u">${f1(p.workedWeeks)} weeks worked so far</div></div>
      <div class="stat"><div class="k">Needed per week from here</div><div class="v num">${p.requiredPerWeek == null ? '—' : f1(p.requiredPerWeek)}</div><div class="u">${p.requiredPerWeek == null ? 'no working weeks left' : `target pace is ${dash(p.weeklyTarget, f1)}`}</div></div>
      <div class="stat"><div class="k">Projected at current pace</div><div class="v num">${dash(p.projectedAnnual, f0)}</div><div class="u">wRVUs by year end</div></div>
      <div class="stat"><div class="k">Working weeks left</div><div class="v num">${f1(p.remainingWorkingWeeks)}</div><div class="u">${p.unplacedOff ? `after ${p.unplacedOff} off-week${p.unplacedOff === 1 ? '' : 's'} not yet placed` : 'all off-weeks placed'}</div></div>
    </section>
    <section class="card">
      <h2>Percentile ladder</h2>
      <p class="sub">Full-time benchmarks × ${f2(s.fte)} FTE. Your marker is your projected year-end wRVUs.</p>
      ${ladderHTML(p, est)}
    </section>
    <section class="card est">
      <h2>Pay estimate <span class="tag">Estimate only</span></h2>
      ${payHTML}
    </section>
    <section class="card">
      <h2>Weeks off</h2>
      <p class="sub">Tap a week to mark it off, past or planned. ${p.offPlaced} of ${p.offAllowance} off-weeks placed (${f0(p.weeksInYear)} weeks in the year, ${f0(s.workingWeeks)} working).</p>
      <div class="weeks" style="margin-top:10px">${weeks}</div>
      <div class="legend"><span><i class="c"></i>this week</span><span><i class="o"></i>off</span><span>small number = wRVUs logged</span></div>
    </section>`;
}

// ---------------------------------------------------------------- planner view

function planCode(code) {
  const i = info(code, fileIdx(today()));
  if (!i) return null;
  return { work: i.work, minutes: cfg(code)?.minutes ?? null, secPct: secPct(code) };
}

function viewPlanner() {
  const idx = fileIdx(today());
  const tot = { A: C.planTotals(state.planner.A, planCode), B: C.planTotals(state.planner.B, planCode) };
  const cmpRow = (label, key, fmt) => {
    const a = tot.A[key];
    const b = tot.B[key];
    const d = a == null || b == null ? null : b - a;
    const better = key === 'minutes' ? (x, y) => x < y : (x, y) => x > y;
    const win = (x, y) => (x != null && y != null && better(x, y) ? ' class="win"' : '');
    return `<tr><td>${label}</td><td${win(a, b)}>${dash(a, fmt)}</td><td${win(b, a)}>${dash(b, fmt)}</td><td>${d == null ? '—' : `${d > 0 ? '+' : ''}${fmt(d)}`}</td></tr>`;
  };
  const options = (sel) => {
    const list = state.codes.map((c) => c.code);
    if (!list.includes(sel)) list.unshift(sel);
    return list.map((code) => {
      const a = info(code, idx) || anyInfo(code);
      return `<option value="${esc(code)}"${code === sel ? ' selected' : ''}>${esc(code)} · ${esc(a ? a.desc : 'unknown')}</option>`;
    }).join('');
  };
  const plan = (id) => {
    const lines = state.planner[id].map((l, n) => {
      const c = planCode(l.code);
      const pct = secPct(l.code);
      const w = c ? (l.sec ? C.creditedWrvu(c.work, 0, l.count, pct) : C.creditedWrvu(c.work, l.count, 0, pct)) : null;
      const mins = c && c.minutes > 0 ? `${f0(l.count * c.minutes)} min` : 'no minutes set';
      return `<div class="pline" data-plan="${id}" data-n="${n}">
        <select data-in="pl-code" aria-label="Code">${options(l.code)}</select>
        <div class="ctl">
          <button class="sbtn minus" data-act="pl-dec" aria-label="Fewer" ${l.count > 1 ? '' : 'disabled'}>−</button>
          <output>${l.count}</output>
          <button class="sbtn plus" data-act="pl-inc" aria-label="More">+</button>
        </div>
        <div class="row2">
          <label><input type="checkbox" data-in="pl-sec"${l.sec ? ' checked' : ''}> as 2nd procedure (${f0(pct)}%)</label>
          <span>${w == null ? 'no wRVU' : `${f2(w)} wRVU`} · ${mins} <button class="x" data-act="pl-del">remove</button></span>
        </div>
      </div>`;
    }).join('');
    const t = tot[id];
    return `<section class="card">
      <h2>Half-day ${id}</h2>
      ${lines || '<p class="sub">No codes yet.</p>'}
      <div class="ptot">
        <button class="btn ghost" data-act="pl-add" data-plan="${id}">+ Add code</button>
        <span><b>${f2(t.wrvu)}</b> wRVU · <b>${f0(t.minutes)}</b> min${t.minutes ? ` (${f1(t.minutes / 60)} h)` : ''}</span>
      </div>
      ${t.missingMinutes.length ? `<p class="note">No minutes set for ${t.missingMinutes.map(esc).join(', ')}, so the time total leaves them out. Set minutes under Codes.</p>` : ''}
    </section>`;
  };
  return `
    <section class="card">
      <h2>Compare two half-days</h2>
      <table class="cmp">
        <thead><tr><th></th><th>A</th><th>B</th><th>B − A</th></tr></thead>
        <tbody>
          ${cmpRow('Total wRVU', 'wrvu', f2)}
          ${cmpRow('Total minutes', 'minutes', f0)}
          ${cmpRow('wRVU per hour', 'perHour', f2)}
        </tbody>
      </table>
    </section>
    ${plan('A')}${plan('B')}
    <p class="note">Uses your minutes and "credited at %" values from Codes, and wRVUs from ${esc(data.files[idx].id)}.</p>`;
}

// ---------------------------------------------------------------- settings view

function settingsDerived() {
  const s = state.settings;
  const scaled = C.scaleBenchmarks(s.wrvuBench, s.fte);
  const out = {
    'd-weekly': `${f1(s.annualTarget / s.workingWeeks)} wRVU per working week`,
    'd-year': `Runs to ${fmtDateLong(C.addDays(C.yearEnd(s.yearStart), -1))}, ${C.weeksInYear(s.yearStart).length} weeks`,
    'd-offset': s.pctOffset >= 0 ? `Pay percentile = wRVU percentile minus ${f0(s.pctOffset)}` : `Pay percentile = wRVU percentile plus ${f0(-s.pctOffset)}`,
    'd-bench': C.isAscending(s.wrvuBench) && C.isAscending(s.payBench) ? '' : 'Each table must rise from the 10th to the 90th percentile.',
  };
  for (const p of C.PCTS) out[`d-sc-${p}`] = f0(scaled[p]);
  return out;
}

function refreshSettingsDerived() {
  for (const [id, text] of Object.entries(settingsDerived())) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }
}

function viewSettings() {
  const s = state.settings;
  const d = settingsDerived();
  const num = (k, label, hint, attrs) => `<div class="field">
    <label for="set-${k}">${label}<small${hint.id ? ` id="${hint.id}"` : ''}>${esc(hint.text)}</small></label>
    <input id="set-${k}" type="number" inputmode="decimal" data-in="set" data-k="${k}" value="${s[k]}" ${attrs}>
  </div>`;
  const benchRows = C.PCTS.map((p) => `<tr>
    <td>${p}th</td>
    <td><input type="number" inputmode="decimal" min="0" data-in="bench" data-t="wrvuBench" data-p="${p}" value="${s.wrvuBench[p]}" aria-label="${p}th percentile full-time wRVUs"></td>
    <td class="num" id="d-sc-${p}">${d[`d-sc-${p}`]}</td>
    <td><input type="number" inputmode="decimal" min="0" data-in="bench" data-t="payBench" data-p="${p}" value="${s.payBench[p]}" aria-label="${p}th percentile full-time pay"></td>
  </tr>`).join('');
  const fileOpts = [`<option value="auto"${s.rvuFile === 'auto' ? ' selected' : ''}>Auto, by date</option>`,
    ...data.files.map((f) => `<option value="${esc(f.id)}"${s.rvuFile === f.id ? ' selected' : ''}>Always ${esc(f.id)}</option>`)].join('');
  return `
    <section class="card">
      <h2>My year</h2>
      ${num('fte', 'Clinical FTE', { text: 'Scales the wRVU benchmarks and the pay estimate' }, 'min="0.05" max="2" step="0.05"')}
      ${num('annualTarget', 'Annual wRVU target', { id: 'd-weekly', text: d['d-weekly'] }, 'min="0" step="1"')}
      ${num('workingWeeks', 'Working weeks per year', { text: 'The rest are off-weeks you place on the Pace screen' }, 'min="1" max="53" step="1"')}
      <div class="field">
        <label for="set-yearStart">Year start date<small id="d-year">${esc(d['d-year'])}</small></label>
        <input id="set-yearStart" type="date" data-in="set" data-k="yearStart" value="${esc(s.yearStart)}">
      </div>
      ${num('startingYtd', 'Starting wRVUs', { text: 'Earned this year before you began logging here' }, 'min="0" step="0.01"')}
    </section>
    <section class="card">
      <h2>Benchmarks (full-time)</h2>
      <table class="bench">
        <thead><tr><th>Pct</th><th>wRVU</th><th>× FTE</th><th>Pay $</th></tr></thead>
        <tbody>${benchRows}</tbody>
      </table>
      <p class="note" id="d-bench" style="color:var(--bad)">${esc(d['d-bench'])}</p>
      ${num('pctOffset', 'Percentile offset', { id: 'd-offset', text: d['d-offset'] }, 'min="-100" max="100" step="1"')}
    </section>
    <section class="card">
      <h2>CMS file</h2>
      <div class="field">
        <label for="set-rvuFile">RVU release<small>Auto uses the release in effect for each week</small></label>
        <select id="set-rvuFile" data-in="set" data-k="rvuFile">${fileOpts}</select>
      </div>
      <p class="note">${data.files.map((f) => `${esc(f.id)}: released ${fmtDateLong(f.released)}, effective ${fmtDateLong(f.effectiveFrom)}`).join('. ')}. A week uses the release in effect on its Monday.</p>
    </section>
    <section class="card">
      <h2>Backup</h2>
      <p class="sub" style="margin-bottom:10px">Everything is saved only in this browser. Export a JSON file to back it up or move it to another device.</p>
      <div class="btnrow">
        <button class="btn" data-act="export">Export backup</button>
        <button class="btn ghost" data-act="import">Import backup</button>
        <button class="btn danger" data-act="reset">Erase everything</button>
      </div>
    </section>
    <p class="note">No patient information belongs in this app. It stores codes, counts, minutes and your settings, nothing else.</p>`;
}

function setSetting(el) {
  const k = el.dataset.k;
  const prev = state.settings[k];
  const isText = k === 'yearStart' || k === 'rvuFile';
  const value = isText ? el.value : el.value.trim() === '' ? NaN : Number(el.value);
  const cand = normalizeState({ ...state, settings: { ...state.settings, [k]: value } });
  if (cand.settings[k] !== value) {
    el.value = prev;
    toast('That value is out of range, so the previous one was kept.');
    return;
  }
  state.settings[k] = value;
  save();
  refreshSettingsDerived();
  renderHeader();
  renderFooter();
}

function setBench(el) {
  const { t, p } = el.dataset;
  const value = el.value.trim() === '' ? NaN : Number(el.value);
  if (!Number.isFinite(value) || value < 0 || value > 1e9) {
    el.value = state.settings[t][p];
    toast('Enter a number of 0 or more.');
    return;
  }
  state.settings[t][p] = value;
  save();
  refreshSettingsDerived();
}

function exportBackup() {
  const payload = { app: 'rvu-tracker', exported: new Date().toISOString(), ...state };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `rvu-tracker-backup-${today()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Backup file created.');
}

async function importBackup(file) {
  let raw;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    toast('That file is not valid JSON.');
    return;
  }
  if (!raw || typeof raw !== 'object' || (raw.app !== 'rvu-tracker' && !raw.settings)) {
    toast('That does not look like an RVU Tracker backup.');
    return;
  }
  const next = normalizeState(raw);
  const weeks = Object.keys(next.tally).length;
  const when = typeof raw.exported === 'string' ? ` exported ${raw.exported.slice(0, 10)}` : '';
  if (!confirm(`Replace everything saved in this browser with the backup${when}? It has ${next.codes.length} codes and ${weeks} logged week${weeks === 1 ? '' : 's'}.`)) return;
  state = next;
  save();
  render();
  toast('Backup imported.');
}

// ---------------------------------------------------------------- render and events

const VIEWS = { tally: viewTally, codes: viewCodes, pace: viewPace, planner: viewPlanner, settings: viewSettings };

function render() {
  view.innerHTML = VIEWS[ui.tab]();
  document.querySelectorAll('.tabs button').forEach((b) => {
    if (b.dataset.tab === ui.tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  renderHeader();
  renderFooter();
}

document.querySelector('.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b || !data) return;
  ui.tab = b.dataset.tab;
  ui.msg = null;
  if (ui.tab === 'tally') ui.week = ui.week || C.mondayOf(today());
  render();
  window.scrollTo(0, 0);
});

view.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const code = el.closest('[data-code]')?.dataset.code;
  const line = el.closest('.pline');

  switch (act) {
    case 'inc': bump(code, el.dataset.kind, 1); return;
    case 'dec': bump(code, el.dataset.kind, -1); return;
    case 'week': ui.week = C.addDays(ui.week, Number(el.dataset.d)); break;
    case 'week-now': ui.week = C.mondayOf(today()); break;
    case 'tsort': state.settings.tallySort = el.dataset.v; save(); break;
    case 'sort': {
      const k = el.dataset.k;
      if (ui.sortKey === k) ui.sortDir = ui.sortDir === 'asc' ? 'desc' : 'asc';
      else { ui.sortKey = k; ui.sortDir = k === 'code' ? 'asc' : 'desc'; }
      break;
    }
    case 'open': ui.open = ui.open === code ? null : code; break;
    case 'remove':
      if (!confirm(`Remove ${code} from your list? Counts already logged are kept.`)) return;
      state.codes = state.codes.filter((c) => c.code !== code);
      ui.open = null;
      ui.msg = { err: false, text: `Removed ${code}.` };
      save();
      break;
    case 'weekoff': {
      const w = el.dataset.w;
      state.weeksOff = state.weeksOff.includes(w) ? state.weeksOff.filter((x) => x !== w) : [...state.weeksOff, w].sort();
      save();
      break;
    }
    case 'pl-add': {
      const first = state.codes[0]?.code;
      if (!first) { toast('Add a code under Codes first.'); return; }
      state.planner[el.dataset.plan].push({ code: first, count: 1, sec: false });
      save();
      break;
    }
    case 'pl-inc':
    case 'pl-dec': {
      const l = state.planner[line.dataset.plan][Number(line.dataset.n)];
      l.count = Math.max(1, Math.min(99, l.count + (act === 'pl-inc' ? 1 : -1)));
      save();
      break;
    }
    case 'pl-del': state.planner[line.dataset.plan].splice(Number(line.dataset.n), 1); save(); break;
    case 'export': exportBackup(); return;
    case 'import': $('#import-file').click(); return;
    case 'reset':
      if (!confirm('Erase all codes, counts and settings saved in this browser? This cannot be undone. Export a backup first if you want to keep them.')) return;
      state = defaultState();
      save();
      toast('Everything erased. Defaults restored.');
      break;
    default: return;
  }
  render();
});

view.addEventListener('input', (e) => {
  const el = e.target;
  const kind = el.dataset.in;
  if (kind === 'filter') {
    ui.filter = el.value.trim().toLowerCase();
    view.querySelectorAll('.trow').forEach((row) => { row.hidden = !!ui.filter && !row.dataset.text.includes(ui.filter); });
  } else if (kind === 'minutes') {
    const row = el.closest('[data-code]');
    const c = cfg(row.dataset.code);
    const n = el.value.trim() === '' ? null : Number(el.value);
    c.minutes = n != null && Number.isFinite(n) && n > 0 && n <= 1440 ? n : null;
    save();
    const i = info(c.code, fileIdx(today()));
    $('.ph', row).textContent = dash(i ? C.wrvuPerHour(i.work, c.minutes) : null, f2);
  } else if (kind === 'secpct') {
    const c = cfg(el.closest('[data-code]').dataset.code);
    const n = el.value.trim() === '' ? null : Number(el.value);
    c.secPct = n != null && Number.isFinite(n) && n >= 0 && n <= 200 ? n : null;
    save();
  }
});

view.addEventListener('change', (e) => {
  const el = e.target;
  const kind = el.dataset.in;
  if (kind === 'set') setSetting(el);
  else if (kind === 'bench') setBench(el);
  else if (kind === 'pl-code' || kind === 'pl-sec') {
    const line = el.closest('.pline');
    const l = state.planner[line.dataset.plan][Number(line.dataset.n)];
    if (kind === 'pl-code' && isCode(el.value)) l.code = el.value;
    if (kind === 'pl-sec') l.sec = el.checked;
    save();
    render();
  }
});

view.addEventListener('submit', (e) => {
  if (e.target.dataset.form !== 'add') return;
  e.preventDefault();
  addCode(new FormData(e.target).get('code') || '');
});

$('#import-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) importBackup(file);
});

// ---------------------------------------------------------------- start

async function start() {
  try {
    const res = await fetch('data/rvu.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    view.innerHTML = `<div class="warnbox">Could not load the CMS data file (data/rvu.json): ${esc(err.message)}.
      Open the app through a web server rather than as a file. See README.</div>`;
    return;
  }
  load();
  ui.week = C.mondayOf(today());
  render();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

start();
