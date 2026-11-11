# RVU Tracker

A personal wRVU tracker for a facility-based pain practice. It is a static site: plain HTML,
CSS and JavaScript, no framework, no build step, no backend, no login, no dependencies.

**No patient information belongs in this app.** It stores codes, counts, minutes and your
settings. There are no free-text fields.

## Run it locally

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765. It must be opened through a web server, not by double-clicking
`index.html`, because browsers block the data file and script modules on `file://` pages.

## Tests

```bash
npm test
```

Uses Node's built-in test runner (Node 20 or newer). The tests cover interpolation, percentile
lookup, the pay estimate, pace, credit rules, the planner totals, saved-state cleaning, and a
check of every bundled value against the raw CMS rows in `cms-source/`.

## Host it for free (GitHub Pages)

`.github/workflows/pages.yml` runs the tests on every push to `main` and, if they pass,
publishes only the site files:

```
index.html  styles.css  sw.js  manifest.webmanifest  icon.svg  icon-180.png  robots.txt
js/  data/
```

`cms-source/` is in `.gitignore` and never leaves this computer. In the repository settings,
Pages → Source must be set to "GitHub Actions". The site address is
`https://<account>.github.io/rvu-tracker/`.

On GitHub's free plan Pages needs a public repository, so the code, including the default
targets and benchmark tables in `js/state.js`, is readable by anyone. Your logged counts and
any settings you change are not in the repository; they stay in your browser.

The page carries a `noindex` tag because the bundled code descriptions are copyright the
American Medical Association. Keep the link to yourself. (`robots.txt` only takes effect on a
custom domain, since a project site is not at the root of `github.io`.)

Any other static host works too: upload the files listed above.

On your phone, open the site and use "Add to Home Screen". Once hosted over https it works
offline. It shows the saved copy at once and refreshes in the background, so an update you
deploy appears the second time you open the app. The workflow gives each deploy its own cache
name, so old offline copies are dropped automatically.

Data is saved per browser and per site address. Use Settings → Export backup before changing
phones, browsers or hosting address, and Import backup afterwards.

## Where the numbers come from

`data/rvu.json` is generated from the CMS Physician Fee Schedule Relative Value Files. Nothing
in it is typed by hand.

| Release | CSV inside the zip | Released | Effective |
|---|---|---|---|
| RVU26D | `PPRRVU2026_Oct_nonQPP.csv` | 2026-08-26 | 2026-10-01 |
| RVU27A | `PPRRVU2027_Jan.csv` | 2026-11-10 | 2027-01-01 |

Source page: https://www.cms.gov/medicare/payment/fee-schedules/physician/pfs-relative-value-files

Per code the app reads: description, work RVU, facility total RVU, global period,
multiple-procedure indicator, bilateral indicator and status. Only codes with a work RVU in at
least one release are bundled (7,642 codes).

- **Add-on codes.** The file has no add-on column. A global period of `ZZZ` marks a code that is
  always reported with another service, and the app uses that.
- **Codes with a technical component** (for example 77003, 76942). The app uses the `-26`
  professional-component row, which is what a physician bills in a facility.
- **Which release applies.** With "Auto, by date" a week uses the release in effect on its
  Monday. You can pin one release in Settings.

### Updating to a new CMS release

1. Download the zip from the source page and unzip the `PPRRVU*.csv` into `cms-source/`.
2. Add an entry to `SOURCES` in `tools/build-data.mjs` (id, csv, zip, effectiveFrom).
3. Run `npm run build-data`, then `npm test`.

The build stops with an error if the CSV columns have moved.

## How things are calculated

All of this lives in `js/calc.js`.

**Credit.** A count logged with + is credited at the full work RVU. A count logged under
"As 2nd" is credited at that code's "credited at %" value. The default is 50% for codes with
multiple-procedure indicator 2 or 3 and 100% for everything else, including add-ons. Changing
the percent re-credits past weeks too.

**Weeks.** Weeks run Monday to Sunday. A week counts toward the measurement year its Monday
falls in. With an October 1, 2026 start that is 52 weeks, October 5, 2026 to the week of
September 27, 2027.

**Year to date.** "Starting wRVUs" from Settings plus every logged week in the year.

**Pace.**

- Weekly target = annual target ÷ working weeks.
- Weeks worked = completed weeks not marked off, plus the part of this week already done
  (weekdays up to and including today, out of five).
- Off-week allowance = weeks in the year − working weeks. Off-weeks you have not yet placed on
  the calendar are assumed to still be ahead of you.
- Working weeks left = future weeks not marked off + the rest of this week − unplaced off-weeks.
- Needed per week = (target − year to date) ÷ working weeks left.
- Projected year end = year to date + (average per worked week × working weeks left).

**Percentile.** Each full-time wRVU benchmark is multiplied by your clinical FTE. Your projected
year-end wRVUs are placed on that scaled table by straight-line interpolation between the two
nearest points. Below the 10th or above the 90th the app says so and uses the 10th or 90th.

**Pay estimate.** Pay percentile = wRVU percentile − offset (default 10). Full-time pay at that
percentile is interpolated from the pay table, then multiplied by FTE. If the pay percentile
falls below the 10th the 10th-percentile pay is used and labelled. This is an estimate from
your pace and your tables, not a statement of compensation.

**Planner.** Each half-day is a list of codes and counts. Totals use your minutes and credit
percentages. A code with no minutes is left out of the time total and named in a note.
