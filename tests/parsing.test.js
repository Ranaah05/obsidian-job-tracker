// Tests for the note-parsing and value-cleaning helpers.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadScript, plain } = require('./load');

const S = loadScript();

describe('parseFrontmatter_', () => {
  it('returns null when there is no front matter', () => {
    assert.equal(S.parseFrontmatter_('# Just a heading\n\nBody text'), null);
    assert.equal(S.parseFrontmatter_(''), null);
  });

  it('reads quoted values and unescapes \\"', () => {
    const fm = S.parseFrontmatter_('---\ncompany: "Paylocity"\nnotes: "Say \\"hi\\""\n---\n');
    assert.equal(fm.company, 'Paylocity');
    assert.equal(fm.notes, 'Say "hi"');
  });

  it('reads unquoted values', () => {
    const fm = S.parseFrontmatter_('---\ntracker: job\ncreated: 2026-10-07\n---\n');
    assert.equal(fm.tracker, 'job');
    assert.equal(fm.created, '2026-10-07');
  });

  it('lowercases keys', () => {
    const fm = S.parseFrontmatter_('---\nCompany: Acme\nJob_Title: Engineer\n---\n');
    assert.equal(fm.company, 'Acme');
    assert.equal(fm.job_title, 'Engineer');
    assert.equal(fm.Company, undefined);
  });

  it('joins YAML list items with ", "', () => {
    const fm = S.parseFrontmatter_('---\ntags:\n  - "clippings"\n  - "job"\n---\n');
    assert.equal(fm.tags, 'clippings, job');
  });

  it('handles a leading BOM and Windows line endings', () => {
    const text = '﻿---\r\ntracker: job\r\ncompany: "Acme"\r\ntags:\r\n  - a\r\n  - b\r\n---\r\nBody';
    const fm = S.parseFrontmatter_(text);
    assert.equal(fm.tracker, 'job');
    assert.equal(fm.company, 'Acme');
    assert.equal(fm.tags, 'a, b');
  });

  it('parses examples/sample-job-note.md', () => {
    const text = fs.readFileSync(path.join(__dirname, '..', 'examples', 'sample-job-note.md'), 'utf8');
    const fm = S.parseFrontmatter_(text);
    assert.equal(fm.tracker, 'job');
    assert.equal(fm.company, 'Example Corp');
    assert.equal(fm.job_title, 'Software Engineer I');
    assert.equal(fm.source, 'https://example.com/jobs/12345');
    assert.equal(fm.tags, 'clippings, job');
  });
});

describe('clean_', () => {
  it('trims and collapses tabs/newlines into spaces', () => {
    assert.equal(S.clean_('  Python,\n\tSQL \r\n'), 'Python, SQL');
  });

  it('turns placeholder answers into ""', () => {
    for (const v of ['Not specified', 'N/A', 'none', 'unknown', 'Not stated.', 'NOT SPECIFIED', 'n/a', 'NA']) {
      assert.equal(S.clean_(v), '', `expected "${v}" to be cleaned`);
    }
  });

  it('keeps real values unchanged', () => {
    assert.equal(S.clean_('Example Corp'), 'Example Corp');
    assert.equal(S.clean_('0-2 years'), '0-2 years');
    assert.equal(S.clean_('None of the above required'), 'None of the above required');
  });

  it('turns null/undefined into ""', () => {
    assert.equal(S.clean_(null), '');
    assert.equal(S.clean_(undefined), '');
  });
});

describe('key_', () => {
  it('lowercases and strips query, fragment and trailing slash', () => {
    assert.equal(S.key_('https://Example.com/job/1/?utm=x'), 'https://example.com/job/1');
    assert.equal(S.key_('https://example.com/job/1#apply'), 'https://example.com/job/1');
    assert.equal(S.key_('  https://example.com/job/1/  '), 'https://example.com/job/1');
  });

  it('returns "" for empty input', () => {
    assert.equal(S.key_(''), '');
    assert.equal(S.key_(undefined), '');
  });
});

describe('folderId_', () => {
  it('reads the id from a /folders/ link', () => {
    assert.equal(S.folderId_('https://drive.google.com/drive/folders/1AbC-d_9?usp=sharing'), '1AbC-d_9');
  });

  it('reads the id from an ?id= link', () => {
    assert.equal(S.folderId_('https://drive.google.com/open?id=1DHh_x-Y&usp=drive_fs'), '1DHh_x-Y');
  });

  it('returns a bare id trimmed', () => {
    assert.equal(S.folderId_('  1AbC-d_9  '), '1AbC-d_9');
  });
});

describe('toDate_', () => {
  it('turns YYYY-MM-DD into midday local time', () => {
    const d = S.toDate_('2026-10-07');
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 9);
    assert.equal(d.getDate(), 7);
    assert.equal(d.getHours(), 12);
    assert.equal(d.getMinutes(), 0);
  });

  it('returns null for non-dates', () => {
    assert.equal(S.toDate_('yesterday'), null);
    assert.equal(S.toDate_(''), null);
    assert.equal(S.toDate_(undefined), null);
  });
});

describe('oneOf_', () => {
  it('matches case-insensitively and returns the list spelling', () => {
    assert.equal(S.oneOf_('software engineering', S.CATEGORIES), 'Software Engineering');
    assert.equal(S.oneOf_('DATA SCIENCE', S.CATEGORIES), 'Data Science');
  });

  it('returns "" when nothing matches', () => {
    assert.equal(S.oneOf_('Robotics', S.CATEGORIES), '');
    assert.equal(S.oneOf_('', S.CATEGORIES), '');
  });
});

describe('buildRow_', () => {
  const HEADERS = ['Month', 'Date Applied', 'Company', 'Exact Job Title', 'Job Category', 'Location',
    'Work Arrangement', 'Employment Type', 'Application Status', 'Skills / Technologies Requested',
    'Job Posting URL', 'Salary', 'Experience Required', 'Degree / Education Requirement',
    'Date Last Updated', 'Notes', 'Applicant', 'Applied By', 'Resume'];
  const map = Object.fromEntries(HEADERS.map((h, i) => [h, i + 1]));
  const width = HEADERS.length;
  const URL = 'https://example.com/jobs/1';
  const base = { company: 'Acme', skills: 'Python', job_title: 'Engineer', created: '2026-10-07' };
  const build = (fm) => S.buildRow_({ ...base, ...fm }, 'Rannss', URL, map, width);
  const cell = (row, header) => row[map[header] - 1];

  it('returns a row of the requested width', () => {
    assert.equal(build({}).length, width);
  });

  it('places applicant and URL in their columns', () => {
    const row = build({});
    assert.equal(cell(row, 'Applicant'), 'Rannss');
    assert.equal(cell(row, 'Job Posting URL'), URL);
  });

  it('defaults status to Submitted', () => {
    assert.equal(cell(build({}), 'Application Status'), 'Submitted');
    assert.equal(cell(build({ status: 'interview' }), 'Application Status'), 'Interview');
  });

  it('normalizes job category', () => {
    assert.equal(cell(build({ job_category: 'software engineering' }), 'Job Category'), 'Software Engineering');
    assert.equal(cell(build({ job_category: 'Robotics' }), 'Job Category'), 'Other');
    assert.equal(cell(build({ job_category: '' }), 'Job Category'), '');
  });

  it('normalizes onsite / on site to On-site', () => {
    assert.equal(cell(build({ work_arrangement: 'onsite' }), 'Work Arrangement'), 'On-site');
    assert.equal(cell(build({ work_arrangement: 'on site' }), 'Work Arrangement'), 'On-site');
    assert.equal(cell(build({ work_arrangement: 'remote' }), 'Work Arrangement'), 'Remote');
  });

  it('clears placeholder experience', () => {
    assert.equal(cell(build({ experience: 'Not specified' }), 'Experience Required'), '');
  });

  it('falls back to title when job_title is missing', () => {
    const row = build({ job_title: undefined, title: 'Data Analyst' });
    assert.equal(cell(row, 'Exact Job Title'), 'Data Analyst');
  });

  it('adds the "fill in by hand" note when company and skills are empty', () => {
    assert.match(cell(build({ company: '', skills: '' }), 'Notes'), /fill in by hand/);
    assert.equal(cell(build({}), 'Notes'), '');
  });

  it('takes Date Applied from created at midday local time', () => {
    const d = cell(build({}), 'Date Applied');
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 9);
    assert.equal(d.getDate(), 7);
    assert.equal(d.getHours(), 12);
  });

  it('skips columns missing from the sheet', () => {
    const small = { Company: 1, Applicant: 2 };
    const row = S.buildRow_(base, 'Rannss', URL, small, 2);
    assert.deepEqual(plain(row), ['Acme', 'Rannss']);
  });
});
