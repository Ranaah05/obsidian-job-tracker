/**
 * Job Tracker — auto-imports Obsidian Web Clipper job notes from Google Drive
 * into this Google Sheet, for one or more people.
 *
 * HOW IT WORKS
 *  - Each person's Obsidian "Clippings" folder syncs to Google Drive.
 *  - The Settings tab lists each person + a link to their Clippings folder.
 *  - When you click Job Tracker → Import new clips now, importClips() looks in each folder (and sub-folders) for
 *    notes with `tracker: job` in their properties, and adds one row per new job.
 *  - Notes already imported are remembered on the hidden "Imported" tab, so a
 *    job is never added twice.
 *
 * FIRST TIME: paste this whole file into Extensions → Apps Script, save, then run
 * setup() once (or use the "Job Tracker" menu → Run setup).
 */

const APPS = "Applications";
const SETTINGS = "Settings";
const DASH = "Dashboard";
const LOG = "Imported";

const COLS = {
  month: "Month",
  applicant: "Applicant",
  appliedBy: "Applied By",
  applied: "Date Applied",
  company: "Company",
  title: "Exact Job Title",
  category: "Job Category",
  location: "Location",
  arrangement: "Work Arrangement",
  employment: "Employment Type",
  status: "Application Status",
  skills: "Skills / Technologies Requested",
  url: "Job Posting URL",
  salary: "Salary",
  experience: "Experience Required",
  education: "Degree / Education Requirement",
  updated: "Date Last Updated",
  notes: "Notes",
};
const BASE_HEADERS = [
  COLS.applied,
  COLS.company,
  COLS.title,
  COLS.category,
  COLS.location,
  COLS.arrangement,
  COLS.employment,
  COLS.status,
  COLS.skills,
  COLS.url,
  COLS.salary,
  COLS.experience,
  COLS.education,
  COLS.updated,
  COLS.notes,
];

const CATEGORIES = [
  "Software Engineering",
  "Data Science",
  "Machine Learning / AI",
  "Data Engineering",
  "Other",
];
const ARRANGEMENTS = ["Remote", "Hybrid", "On-site"];
const EMPLOYMENT = ["Full-time", "Part-time", "Internship", "Contract"];
const STATUSES = ["Submitted", "Interview", "Rejected"];

// note property name -> sheet column
const PROP_TO_COL = {
  company: COLS.company,
  job_title: COLS.title,
  job_category: COLS.category,
  location: COLS.location,
  work_arrangement: COLS.arrangement,
  employment_type: COLS.employment,
  skills: COLS.skills,
  salary: COLS.salary,
  experience: COLS.experience,
  education: COLS.education,
  notes: COLS.notes,
};

const NAVY = "#1F4E78";
const BANNER = "#2F5F8F";

/* ------------------------------------------------------------------ menu */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Job Tracker")
    .addItem("Import new clips now", "importClips")
    .addItem("Sort & tidy now", "tidyNow")
    .addSeparator()
    .addItem("Run setup (first time / rebuild dashboard)", "setup")
    .addToUi();
}

/* ----------------------------------------------------------------- setup */

function setup() {
  const ss = SpreadsheetApp.getActive();

  // Applications tab
  let apps = ss.getSheetByName(APPS);
  if (!apps) {
    apps = ss.getSheets()[0];
    if (apps.getLastRow() === 0)
      apps.getRange(1, 1, 1, BASE_HEADERS.length).setValues([BASE_HEADERS]);
    apps.setName(APPS);
  }
  let map = headerMap_(apps);
  BASE_HEADERS.forEach((h) => {
    if (!map[h]) {
      apps.getRange(1, apps.getLastColumn() + 1).setValue(h);
      map = headerMap_(apps);
    }
  });
  if (!map[COLS.month]) {
    try {
      apps.insertColumnBefore(1);
      apps.getRange(1, 1).setValue(COLS.month);
    } catch (e) {
      apps.getRange(1, apps.getLastColumn() + 1).setValue(COLS.month);
    }
    map = headerMap_(apps);
  }
  [COLS.applicant, COLS.appliedBy].forEach((h) => {
    if (!map[h]) {
      apps.getRange(1, apps.getLastColumn() + 1).setValue(h);
      map = headerMap_(apps);
    }
  });

  // Settings tab
  let settings = ss.getSheetByName(SETTINGS);
  if (!settings) {
    settings = ss.insertSheet(SETTINGS);
    settings
      .getRange("A1:C1")
      .setValues([
        ["Name", "Clippings folder link (Google Drive)", "Last check"],
      ]);
    settings.getRange("A2:A3").setValues([["Rannss"], ["Friend"]]);
    settings
      .getRange("A1:C1")
      .setFontWeight("bold")
      .setFontColor("white")
      .setBackground(NAVY);
    settings
      .setColumnWidth(1, 160)
      .setColumnWidth(2, 460)
      .setColumnWidth(3, 300);
    settings.getRange("E1").setValue("All");
    settings.getRange("E2").setFormula('=FILTER(A2:A20,A2:A20<>"")');
    settings.getRange("E1:E21").setFontColor("#999999");
    settings
      .getRange("A23")
      .setValue(
        "Add one row per person. Each person shares their Obsidian Clippings folder (in Google Drive) " +
          "with the owner of this sheet, then paste that folder's link in column B. Column E is used by the dashboard filter — leave it.",
      );
    settings.setFrozenRows(1);
  }

  // Fill Applicant on existing rows that don't have one
  const firstName = String(settings.getRange("A2").getValue() || "").trim();
  const last = lastDataRow_(apps, map);
  if (last > 1 && firstName) {
    const r = apps.getRange(2, map[COLS.applicant], last - 1, 1);
    r.setValues(r.getValues().map((v, i) => [v[0] || firstName]));
  }

  // Imported log (hidden)
  let log = ss.getSheetByName(LOG);
  if (!log) {
    log = ss.insertSheet(LOG);
    log
      .getRange("A1:D1")
      .setValues([["Drive file ID", "Note name", "Applicant", "Imported at"]])
      .setFontWeight("bold");
    log.hideSheet();
  }

  formatApplications_(apps, map);
  organize_(apps);
  buildDashboard_(ss, map);
  updateHowTo_(ss);

  // Manual import only (menu button) — remove any old automatic timer
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === "importClips")
    .forEach((t) => ScriptApp.deleteTrigger(t));

  ss.toast(
    "Setup done. Paste each person's Clippings folder link on the Settings tab.",
    "Job Tracker",
    10,
  );
}

function formatApplications_(apps, map) {
  const lastCol = apps.getLastColumn();
  apps
    .getRange(1, 1, 1, lastCol)
    .setFontWeight("bold")
    .setFontColor("white")
    .setBackground(NAVY);
  apps.setFrozenRows(1);
  const n = 999;
  const dv = (col, list) => {
    try {
      apps
        .getRange(2, map[col], n, 1)
        .setDataValidation(
          SpreadsheetApp.newDataValidation()
            .requireValueInList(list, true)
            .setAllowInvalid(true)
            .build(),
        );
    } catch (e) {
      /* column already has its own dropdown (e.g. a Sheets table) — keep it */
    }
  };
  dv(COLS.category, CATEGORIES);
  dv(COLS.arrangement, ARRANGEMENTS);
  dv(COLS.employment, EMPLOYMENT);
  dv(COLS.status, STATUSES);
  try {
    const names = SpreadsheetApp.getActive()
      .getSheetByName(SETTINGS)
      .getRange("A2:A20");
    apps
      .getRange(2, map[COLS.applicant], n, 1)
      .setDataValidation(
        SpreadsheetApp.newDataValidation()
          .requireValueInRange(names, true)
          .setAllowInvalid(true)
          .build(),
      );
  } catch (e) {
    /* ignore */
  }
  apps
    .getRange(2, map[COLS.month], n, 1)
    .setNumberFormat("mmmm yyyy")
    .setFontWeight("bold");

  // Tidy look: show the month only on its first row; shade jobs more than one person applied to
  const M = colLetter_(map[COLS.month]),
    B = colLetter_(map[COLS.appliedBy]);
  const whole = apps.getRange(2, 1, n, apps.getLastColumn());
  const rules = apps
    .getConditionalFormatRules()
    .filter(
      (r) =>
        !r.getRanges().some((g) => g.getRow() === 2 && g.getNumRows() === n),
    );
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=AND($${M}2<>"",$${M}2=$${M}1)`)
      .setFontColor("#FFFFFF")
      .setRanges([apps.getRange(2, map[COLS.month], n, 1)])
      .build(),
  );
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=REGEXMATCH($${B}2,"&")`)
      .setBackground("#E6F4EA")
      .setRanges([whole])
      .build(),
  );
  apps.setConditionalFormatRules(rules);
  [COLS.applied, COLS.updated].forEach((c) =>
    apps.getRange(2, map[c], n, 1).setNumberFormat("mm/dd/yyyy"),
  );
}

/* ------------------------------------------------------------- dashboard */

function buildDashboard_(ss, map) {
  const old = ss.getSheetByName(DASH);
  if (old) ss.deleteSheet(old);
  const d = ss.insertSheet(DASH, 0);

  const col = (name) => {
    const L = colLetter_(map[name]);
    return `${APPS}!${L}2:${L}`;
  };
  const A = col(COLS.applicant),
    CO = col(COLS.company),
    ST = col(COLS.status),
    CAT = col(COLS.category),
    WA = col(COLS.arrangement),
    DT = col(COLS.applied),
    SK = col(COLS.skills),
    LOC = col(COLS.location);
  const F = "$Z$1"; // applicant criterion ("*" = everyone)
  const pick = `(${A}<>"")*(($B$2="All")+(${A}=$B$2))`;

  const banner = (a1, text) =>
    d
      .getRange(a1)
      .setValue(text)
      .setFontWeight("bold")
      .setFontColor("white")
      .setBackground(BANNER);

  d.getRange("A1")
    .setValue("Job Application Dashboard")
    .setFontSize(16)
    .setFontWeight("bold");
  d.getRange("A2").setValue("Show:").setFontWeight("bold");
  d.getRange("B2")
    .setValue("All")
    .setBackground("#FFF2CC")
    .setFontWeight("bold")
    .setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireValueInRange(
          ss.getSheetByName(SETTINGS).getRange("E1:E21"),
          true,
        )
        .build(),
    );
  d.getRange("C2").setValue("← pick a person, or All").setFontColor("#777777");
  d.getRange("Z1").setFormula('=IF(B2="All","*",B2)').setFontColor("white");

  // Key metrics
  banner("A4:B4", "Key metrics");
  d.getRange("A5:A9").setValues([
    ["Total applications"],
    ["Submitted"],
    ["Interview"],
    ["Rejected"],
    ["Interview rate"],
  ]);
  d.getRange("B5").setFormula(`=COUNTIFS(${CO},"<>",${A},${F})`);
  ["Submitted", "Interview", "Rejected"].forEach((s, i) =>
    d.getRange(6 + i, 2).setFormula(`=COUNTIFS(${ST},"${s}",${A},${F})`),
  );
  d.getRange("B9").setFormula("=IFERROR(B7/B5,0)").setNumberFormat("0.0%");

  // Team
  banner("A11:E11", "Team (everyone)");
  d.getRange("A12:E12")
    .setValues([["Name", "Applied", "Interview", "Rejected", "Interview rate"]])
    .setFontWeight("bold");
  for (let i = 0; i < 5; i++) {
    const r = 13 + i,
      s = `${SETTINGS}!A${2 + i}`;
    d.getRange(r, 1).setFormula(`=IF(${s}="","",${s})`);
    d.getRange(r, 2).setFormula(
      `=IF(A${r}="","",COUNTIFS(${A},A${r},${CO},"<>"))`,
    );
    d.getRange(r, 3).setFormula(
      `=IF(A${r}="","",COUNTIFS(${A},A${r},${ST},"Interview"))`,
    );
    d.getRange(r, 4).setFormula(
      `=IF(A${r}="","",COUNTIFS(${A},A${r},${ST},"Rejected"))`,
    );
    d.getRange(r, 5)
      .setFormula(`=IF(A${r}="","",IFERROR(C${r}/B${r},0))`)
      .setNumberFormat("0.0%");
  }

  // Category
  banner("A19:B19", "By job category");
  CATEGORIES.forEach((c, i) => {
    d.getRange(20 + i, 1).setValue(c);
    d.getRange(20 + i, 2).setFormula(`=COUNTIFS(${CAT},A${20 + i},${A},${F})`);
  });

  // Arrangement
  banner("A26:B26", "By work arrangement");
  ARRANGEMENTS.forEach((c, i) => {
    d.getRange(27 + i, 1).setValue(c);
    d.getRange(27 + i, 2).setFormula(`=COUNTIFS(${WA},A${27 + i},${A},${F})`);
  });

  // Month
  banner("A31:B31", "Applications by month (last 12)");
  d.getRange("A32").setFormula("=EOMONTH(TODAY(),-12)+1");
  for (let i = 1; i < 12; i++)
    d.getRange(32 + i, 1).setFormula(`=EDATE(A${31 + i},1)`);
  for (let i = 0; i < 12; i++) {
    const r = 32 + i;
    d.getRange(r, 2).setFormula(
      `=COUNTIFS(${DT},">="&A${r},${DT},"<"&EDATE(A${r},1),${A},${F})`,
    );
  }
  d.getRange("A32:A43").setNumberFormat("mmm yyyy");

  // Top skills / locations (live formulas)
  banner("G4:H4", "Top 10 skills requested");
  d.getRange("G5").setFormula(
    `=IFERROR(QUERY(ARRAYFORMULA(TRIM(FLATTEN(SPLIT(TEXTJOIN(",",TRUE,FILTER(${SK},${SK}<>"",${pick})),",")))),` +
      `"select Col1, count(Col1) where Col1 <> '' group by Col1 order by count(Col1) desc limit 10 label Col1 'Skill', count(Col1) 'Jobs'",0),"No data yet")`,
  );
  banner("G18:H18", "Top 10 locations");
  d.getRange("G19").setFormula(
    `=IFERROR(QUERY(ARRAYFORMULA(FILTER(${LOC},${LOC}<>"",${pick})),` +
      `"select Col1, count(Col1) group by Col1 order by count(Col1) desc limit 10 label Col1 'Location', count(Col1) 'Jobs'",0),"No data yet")`,
  );

  d.setColumnWidth(1, 200)
    .setColumnWidth(2, 110)
    .setColumnWidth(7, 220)
    .setColumnWidth(8, 60);
  d.setColumnWidths(3, 3, 95);
  d.setFrozenRows(2);

  // Charts (to the right)
  const chart = (builder, row) =>
    d.insertChart(builder.setPosition(row, 10, 0, 0).build());
  chart(
    d
      .newChart()
      .asPieChart()
      .addRange(d.getRange("A6:B8"))
      .setNumHeaders(0)
      .setOption("title", "Application status")
      .setOption("pieHole", 0.4)
      .setOption("colors", ["#2A78D6", "#0CA30C", "#D03B3B"]),
    1,
  );
  chart(
    d
      .newChart()
      .asColumnChart()
      .addRange(d.getRange("A32:B43"))
      .setNumHeaders(0)
      .setOption("title", "Applications by month")
      .setOption("legend", { position: "none" })
      .setOption("colors", ["#2A78D6"]),
    20,
  );
  chart(
    d
      .newChart()
      .asBarChart()
      .addRange(d.getRange("A20:B24"))
      .setNumHeaders(0)
      .setOption("title", "By job category")
      .setOption("legend", { position: "none" })
      .setOption("colors", ["#2A78D6"]),
    39,
  );
  chart(
    d
      .newChart()
      .asBarChart()
      .addRange(d.getRange("G5:H15"))
      .setNumHeaders(1)
      .setOption("title", "Top skills")
      .setOption("legend", { position: "none" })
      .setOption("colors", ["#2A78D6"]),
    58,
  );
}

function updateHowTo_(ss) {
  let h = ss.getSheetByName("How to Use");
  if (!h) h = ss.insertSheet("How to Use");
  h.clear();
  const lines = [
    ["Job Tracker — How to Use"],
    [""],
    [
      'Automatic: clip a job with the "Job → Tracker" Web Clipper template. Then click Job Tracker → Import new clips now.',
    ],
    [
      "Manual: type into the next blank row on Applications. Pick your name in Applicant, then use Job Tracker → Sort & tidy now.",
    ],
    [""],
    [
      "Adding a person: add their name on Settings, and paste the link to their Obsidian Clippings folder in Google Drive.",
    ],
    [
      "They must share that folder with the owner of this sheet (Viewer is enough), and you share this sheet with them (Editor).",
    ],
    [""],
    [
      "Updating status: change Application Status to Interview or Rejected. The dashboard updates by itself.",
    ],
    [
      'Dashboard: use the yellow "Show" box to see one person or All. Everything on the dashboard is a live formula.',
    ],
    [""],
    [
      'Only notes with "tracker: job" in their properties are imported. Rows are sorted by Month, then Company, so when two people apply to the same job their rows sit together. Applied By shows everyone who applied, and those rows are shaded green.',
    ],
  ];
  h.getRange(1, 1, lines.length, 1).setValues(lines);
  h.getRange("A1").setFontSize(14).setFontWeight("bold");
  h.setColumnWidth(1, 900);
}

/* ---------------------------------------------------------------- import */

function importClips() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    const ss = SpreadsheetApp.getActive();
    const apps = ss.getSheetByName(APPS);
    const settings = ss.getSheetByName(SETTINGS);
    const log = ss.getSheetByName(LOG);
    if (!apps || !settings || !log)
      throw new Error("Run setup first (Job Tracker menu → Run setup).");

    const map = headerMap_(apps);
    const width = apps.getLastColumn();
    const done = new Set(
      log.getLastRow() > 1
        ? log
            .getRange(2, 1, log.getLastRow() - 1, 1)
            .getValues()
            .map((r) => String(r[0]))
        : [],
    );

    const last = lastDataRow_(apps, map);
    const ac = map[COLS.applicant] - 1,
      uc0 = map[COLS.url] - 1;
    const seen = new Set(); // "applicant|url" — one row per person per job
    if (last > 1)
      apps
        .getRange(2, 1, last - 1, width)
        .getValues()
        .forEach((r) =>
          seen.add(String(r[ac]).trim().toLowerCase() + "|" + key_(r[uc0])),
        );

    const people = settings.getRange(2, 1, 19, 2).getValues();
    const newRows = [],
      logRows = [];

    people.forEach((p, i) => {
      const name = String(p[0]).trim(),
        link = String(p[1]).trim();
      if (!name || !link) return;
      const status = settings.getRange(i + 2, 3);
      let folder;
      try {
        folder = DriveApp.getFolderById(folderId_(link));
      } catch (e) {
        status.setValue(
          "Can't open this folder — check the link and that it's shared with you",
        );
        return;
      }

      let added = 0;
      walk_(folder, 0, (file) => {
        const id = file.getId();
        if (done.has(id) || !/\.md$/i.test(file.getName())) return;
        const fm = parseFrontmatter_(file.getBlob().getDataAsString("UTF-8"));
        if (!fm) return; // maybe still syncing — try again next run
        done.add(id);
        if (String(fm.tracker || "").toLowerCase() !== "job") {
          logRows.push([id, file.getName(), "(not a job clip)", new Date()]);
          return;
        }
        logRows.push([id, file.getName(), name, new Date()]);
        const url = clean_(fm.source);
        const k = name.toLowerCase() + "|" + key_(url);
        if (url && seen.has(k)) return; // this person already has this job
        seen.add(k);
        newRows.push(buildRow_(fm, name, url, map, width));
        added++;
      });
      status.setValue(
        `OK — checked ${Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "MMM d, h:mm a")}` +
          (added ? ` (+${added} new)` : ""),
      );
    });

    if (newRows.length) {
      const start = last + 1;
      apps.getRange(start, 1, newRows.length, width).setValues(newRows);
      // make URLs clickable
      const uc = map[COLS.url];
      newRows.forEach((r, i) => {
        const u = r[uc - 1];
        if (/^https?:\/\//i.test(u)) {
          apps
            .getRange(start + i, uc)
            .setRichTextValue(
              SpreadsheetApp.newRichTextValue()
                .setText(u)
                .setLinkUrl(u)
                .build(),
            );
        }
      });
    }
    if (logRows.length)
      log
        .getRange(log.getLastRow() + 1, 1, logRows.length, 4)
        .setValues(logRows);
    if (newRows.length) {
      organize_(apps);
      ss.toast(`Added ${newRows.length} new application(s).`, "Job Tracker", 5);
    }
  } finally {
    lock.releaseLock();
  }
}

function buildRow_(fm, applicant, url, map, width) {
  const row = new Array(width).fill("");
  const set = (c, v) => {
    if (map[c]) row[map[c] - 1] = v;
  };
  set(COLS.applicant, applicant);
  set(COLS.applied, toDate_(fm.created) || new Date());
  Object.keys(PROP_TO_COL).forEach((p) => set(PROP_TO_COL[p], clean_(fm[p])));
  if (!clean_(fm.job_title)) set(COLS.title, clean_(fm.title));
  set(
    COLS.category,
    oneOf_(clean_(fm.job_category), CATEGORIES) ||
      (clean_(fm.job_category) ? "Other" : ""),
  );
  set(
    COLS.arrangement,
    oneOf_(
      clean_(fm.work_arrangement).replace(/^on\s?site$/i, "On-site"),
      ARRANGEMENTS,
    ),
  );
  set(
    COLS.employment,
    oneOf_(clean_(fm.employment_type), EMPLOYMENT) ||
      clean_(fm.employment_type),
  );
  set(COLS.status, oneOf_(clean_(fm.status), STATUSES) || "Submitted");
  set(COLS.url, url);
  set(COLS.updated, new Date());
  if (!clean_(fm.company) && !clean_(fm.skills)) {
    set(
      COLS.notes,
      "Clip had little job info (page may hide the description) — fill in by hand.",
    );
  }
  return row;
}

/* -------------------------------------------------------------- organize */

/** Fills Month + Applied By, then sorts: Month -> Company -> Job Title -> Applicant. */
function organize_(apps) {
  apps = apps || SpreadsheetApp.getActive().getSheetByName(APPS);
  const map = headerMap_(apps);
  const last = lastDataRow_(apps, map);
  if (last < 2) return;
  const width = apps.getLastColumn();
  const vals = apps.getRange(2, 1, last - 1, width).getValues();
  const c = (name) => map[name] - 1;

  // who applied to each job (by posting link, or company + title if no link)
  const jobKey = (r) =>
    key_(r[c(COLS.url)]) ||
    (String(r[c(COLS.company)]) + "|" + String(r[c(COLS.title)]))
      .trim()
      .toLowerCase();
  const who = new Map();
  vals.forEach((r) => {
    const k = jobKey(r),
      n = String(r[c(COLS.applicant)]).trim();
    if (!n) return;
    if (!who.has(k)) who.set(k, new Set());
    who.get(k).add(n);
  });

  const monthCol = vals.map((r) => {
    const d = r[c(COLS.applied)];
    return [
      d instanceof Date ? new Date(d.getFullYear(), d.getMonth(), 1) : "",
    ];
  });
  const byCol = vals.map((r) => [
    Array.from(who.get(jobKey(r)) || [])
      .sort()
      .join(" & "),
  ]);
  apps.getRange(2, map[COLS.month], vals.length, 1).setValues(monthCol);
  apps.getRange(2, map[COLS.appliedBy], vals.length, 1).setValues(byCol);

  try {
    apps.getRange(2, 1, last - 1, width).sort([
      { column: map[COLS.month], ascending: true },
      { column: map[COLS.company], ascending: true },
      { column: map[COLS.title], ascending: true },
      { column: map[COLS.applicant], ascending: true },
    ]);
  } catch (e) {
    /* leave order as is if the sheet won't allow sorting */
  }
}

/** Menu item: re-sort after typing rows by hand. */
function tidyNow() {
  organize_();
}

/* --------------------------------------------------------------- helpers */

function parseFrontmatter_(text) {
  text = String(text || "").replace(/^﻿/, "");
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const out = {};
  let lastKey = null;
  m[1].split(/\r?\n/).forEach((line) => {
    const kv = line.match(/^([A-Za-z0-9_\-]+):\s*(.*)$/);
    if (kv) {
      lastKey = kv[1].toLowerCase();
      out[lastKey] = unquote_(kv[2]);
      return;
    }
    const li = line.match(/^\s+-\s+(.*)$/) || line.match(/^-\s+(.*)$/);
    if (li && lastKey) {
      const v = unquote_(li[1]);
      out[lastKey] = out[lastKey] ? out[lastKey] + ", " + v : v;
    }
  });
  return out;
}

function unquote_(s) {
  s = String(s).trim();
  if (/^".*"$/.test(s))
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  if (/^'.*'$/.test(s)) return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

function clean_(v) {
  const s = String(v == null ? "" : v)
    .replace(/[\t\r\n]+/g, " ")
    .trim();
  return /^(n\/?a|none|null|unknown|not (stated|specified|listed|mentioned|provided)\.?)$/i.test(
    s,
  )
    ? ""
    : s;
}

function oneOf_(v, list) {
  const hit = list.find((x) => x.toLowerCase() === String(v).toLowerCase());
  return hit || "";
}

function toDate_(v) {
  const m = String(v || "").match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

function key_(url) {
  return String(url || "")
    .trim()
    .toLowerCase()
    .replace(/[?#].*$/, "")
    .replace(/\/$/, "");
}

function folderId_(link) {
  const m =
    String(link).match(/folders\/([A-Za-z0-9_\-]+)/) ||
    String(link).match(/[?&]id=([A-Za-z0-9_\-]+)/);
  return m ? m[1] : String(link).trim();
}

function walk_(folder, depth, fn) {
  const files = folder.getFiles();
  while (files.hasNext()) fn(files.next());
  if (depth >= 3) return;
  const subs = folder.getFolders();
  while (subs.hasNext()) walk_(subs.next(), depth + 1, fn);
}

function headerMap_(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const map = {};
  sheet
    .getRange(1, 1, 1, lastCol)
    .getValues()[0]
    .forEach((h, i) => {
      const k = String(h).trim();
      if (k) map[k] = i + 1;
    });
  return map;
}

function lastDataRow_(sheet, map) {
  const lr = sheet.getLastRow();
  if (lr < 2) return 1;
  const cols = [COLS.company, COLS.title, COLS.url]
    .map((c) => map[c])
    .filter(Boolean);
  const vals = sheet.getRange(1, 1, lr, sheet.getLastColumn()).getValues();
  for (let r = lr - 1; r >= 1; r--) {
    if (cols.some((c) => String(vals[r][c - 1]).trim() !== "")) return r + 1;
  }
  return 1;
}

function colLetter_(n) {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
