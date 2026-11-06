// Tests for the job-lead filters.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadScript, plain } = require('./load');

const S = loadScript();

const defaultStates = () => new Set(S.DEFAULT_LEAD_STATES.split(/[^A-Z]+/).filter(Boolean));

describe('isUS_', () => {
  it('accepts US locations', () => {
    assert.equal(S.isUS_(['Austin, TX']), true);
    assert.equal(S.isUS_(['Remote in USA']), true);
    assert.equal(S.isUS_(['New York, United States']), true);
  });

  it('rejects non-US locations', () => {
    assert.equal(S.isUS_(['London, UK']), false);
    assert.equal(S.isUS_(['Toronto, ON']), false);
  });

  it('treats an empty list as US', () => {
    assert.equal(S.isUS_([]), true);
  });
});

describe('locationOk_', () => {
  const prefs = { states: defaultStates(), remote: true, types: ['New Grad', 'Internship'] };

  it('keeps locations in preferred states', () => {
    for (const locs of [
      ['Boston, MA'],
      ['Merrimack, NH'],
      ['Santa Rosa, CA'],
      ['SF'],
      ['Remote in USA'],
      ['Seattle, WA', 'Irvine, CA'],
      ['San Jose, California, United States'],
    ]) {
      assert.equal(S.locationOk_(locs, prefs), true, `expected ${JSON.stringify(locs)} to be kept`);
    }
  });

  it('drops locations outside preferred states', () => {
    for (const locs of [['Austin, TX'], ['Seattle, WA'], ['Chicago, IL']]) {
      assert.equal(S.locationOk_(locs, prefs), false, `expected ${JSON.stringify(locs)} to be dropped`);
    }
  });

  it('matches full state names as whole words, longest name first', () => {
    const only = (...codes) => ({ ...prefs, states: new Set(codes) });
    assert.equal(S.locationOk_(['Charleston, West Virginia'], only('VA')), false);
    assert.equal(S.locationOk_(['Charleston, West Virginia'], only('WV')), true);
    assert.equal(S.locationOk_(['Richmond, Virginia'], only('VA')), true);
    assert.equal(S.locationOk_(['Kansas City, Kansas'], only('KS')), true);
    assert.equal(S.locationOk_(['Kansas City, Kansas'], only('AR')), false);
    assert.equal(S.locationOk_(['Little Rock, Arkansas'], only('KS')), false);
    assert.equal(S.locationOk_(['Little Rock, Arkansas'], only('AR')), true);
  });

  it('decides by a two-letter state code alone when there is one', () => {
    const only = (...codes) => ({ ...prefs, states: new Set(codes) });
    assert.equal(S.locationOk_(['Kansas City, MO'], only('KS')), false);
    assert.equal(S.locationOk_(['Kansas City, MO'], only('MO')), true);
  });

  it('drops remote jobs when remote is off', () => {
    assert.equal(S.locationOk_(['Remote in USA'], { ...prefs, remote: false }), false);
  });
});

describe('leadPrefs_', () => {
  const fakeSs = (cells) => ({
    getSheetByName: (name) =>
      name === 'Settings' ? { getRange: (a1) => ({ getValue: () => cells[a1] ?? '' }) } : null,
  });

  it('reads lead types from I2', () => {
    assert.deepEqual(plain(S.leadPrefs_(fakeSs({ I2: 'Both' })).types), ['New Grad', 'Internship']);
    assert.deepEqual(plain(S.leadPrefs_(fakeSs({})).types), ['New Grad', 'Internship']);
    assert.deepEqual(plain(S.leadPrefs_(fakeSs({ I2: 'New Grad' })).types), ['New Grad']);
    assert.deepEqual(plain(S.leadPrefs_(fakeSs({ I2: 'Internship' })).types), ['Internship']);
  });

  it('reads the remote flag from H2', () => {
    assert.equal(S.leadPrefs_(fakeSs({ H2: 'no' })).remote, false);
    assert.equal(S.leadPrefs_(fakeSs({ H2: 'yes' })).remote, true);
    assert.equal(S.leadPrefs_(fakeSs({})).remote, true);
  });

  it('reads states from G2, falling back to the defaults', () => {
    assert.deepEqual([...S.leadPrefs_(fakeSs({})).states].sort(), [...defaultStates()].sort());
    assert.deepEqual([...S.leadPrefs_(fakeSs({ G2: 'ma, ny' })).states].sort(), ['MA', 'NY']);
  });

  it('uses defaults when there is no Settings tab', () => {
    const p = S.leadPrefs_({ getSheetByName: () => null });
    assert.equal(p.remote, true);
    assert.deepEqual(plain(p.types), ['New Grad', 'Internship']);
  });
});

describe('pastTermsOnly_', () => {
  // Freeze "now" at 2026-11-06 inside the script; dates with arguments behave normally.
  class FrozenDate extends Date {
    constructor(...args) {
      if (args.length) super(...args);
      else super(2026, 10, 6, 12);
    }
    static now() {
      return new Date(2026, 10, 6, 12).getTime();
    }
  }
  const T = loadScript({ Date: FrozenDate });

  it('is true when every term is this year or earlier', () => {
    assert.equal(T.pastTermsOnly_(['Summer 2026']), true);
  });

  it('is false when any term is in a future year', () => {
    assert.equal(T.pastTermsOnly_(['Summer 2027']), false);
    assert.equal(T.pastTermsOnly_(['Spring 2026', 'Summer 2027']), false);
  });

  it('is false when terms are missing or have no year', () => {
    assert.equal(T.pastTermsOnly_(['N/A']), false);
    assert.equal(T.pastTermsOnly_([]), false);
    assert.equal(T.pastTermsOnly_(undefined), false);
  });
});
