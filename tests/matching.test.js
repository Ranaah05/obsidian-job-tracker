// Tests for résumé/lead matching and small sheet helpers.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadScript } = require('./load');

const S = loadScript();

describe('titleOverlap_', () => {
  it('returns 1 for identical titles', () => {
    assert.equal(S.titleOverlap_('Software Engineer I', 'Software Engineer I'), 1);
  });

  it('scores unrelated titles below 0.5', () => {
    assert.ok(S.titleOverlap_('Junior Software Engineer, Edge Platform', '(Jr) Machine Learning (ML) Developer') < 0.5);
  });

  it('ignores stop words and punctuation', () => {
    assert.equal(S.titleOverlap_('Engineer, the Platform!', 'Platform Engineer'), 1);
    assert.equal(S.titleOverlap_('Head of Data', 'Data Head'), 1);
  });

  it('returns 0 for an empty file title', () => {
    assert.equal(S.titleOverlap_('', 'Software Engineer'), 0);
    assert.equal(S.titleOverlap_('the and of', 'Software Engineer'), 0);
  });
});

describe('colLetter_', () => {
  it('converts column numbers to letters', () => {
    assert.equal(S.colLetter_(1), 'A');
    assert.equal(S.colLetter_(16), 'P');
    assert.equal(S.colLetter_(26), 'Z');
    assert.equal(S.colLetter_(27), 'AA');
    assert.equal(S.colLetter_(52), 'AZ');
  });
});

describe('norm_', () => {
  it('lowercases and drops non-alphanumerics', () => {
    assert.equal(S.norm_('Example Corp, Inc.'), 'examplecorpinc');
    assert.equal(S.norm_(null), '');
  });
});

describe('isApplied_', () => {
  const idx = {
    urls: new Set([S.key_('https://example.com/jobs/1')]),
    pairs: [[S.norm_('Example Corp'), 'Software Engineer I']],
  };

  it('matches by URL, ignoring the query string', () => {
    assert.equal(S.isApplied_(idx, { url: 'https://Example.com/jobs/1?src=simplify', company: 'Other', role: 'X' }), true);
  });

  it('matches same company (normalized) with a similar title', () => {
    assert.equal(S.isApplied_(idx, { url: '', company: 'example corp', role: 'Software Engineer I' }), true);
    assert.equal(S.isApplied_(idx, { url: '', company: 'Example-Corp', role: 'Software Engineer' }), true);
  });

  it('does not match same company with an unrelated title', () => {
    assert.equal(S.isApplied_(idx, { url: '', company: 'Example Corp', role: 'Data Analyst Intern' }), false);
  });

  it('does not match a different company', () => {
    assert.equal(S.isApplied_(idx, { url: '', company: 'Acme', role: 'Software Engineer I' }), false);
  });
});
