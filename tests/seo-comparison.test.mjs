import test from 'node:test';
import assert from 'node:assert/strict';
import { compareAuditMetadata } from '../lib/seo-audit/compare.ts';
const page = (url, language = 'en', overrides = {}) => ({ url, finalUrl: url, canonical: url, language, indexable: true, title: 'Renting in Hanoi', description: 'Practical rental advice.', content: { score: 100, findings: [{ id: 'title', category: 'content', severity: 'passed' }] }, technical: { score: 100, findings: [] }, ...overrides });
test('duplicate metadata comparisons isolate languages, canonical aliases and private indexing intentions', () => {
  const first = page('https://garyhome.vn/a');
  const state = { pages: [first, page(first.url, 'vi'), page('https://garyhome.vn/alias', 'en', { canonical: first.url }), page('https://garyhome.vn/private', 'en', { indexable: false })] };
  compareAuditMetadata(state);
  assert.equal(first.content.score, 100);
  assert.equal(first.content.findings.length, 1);
  state.pages.push(page('https://garyhome.vn/b'));
  compareAuditMetadata(state);
  assert.equal(first.content.findings.filter(f => f.id.startsWith('content-duplicate')).length, 2);
  assert.equal(first.technical.score, 100);
  assert.equal(state.pages[1].content.score, 100);
  compareAuditMetadata(state);
  assert.equal(first.content.findings.length, 3, 'resumed chunks do not accumulate duplicate findings');
});
test('failed or uninspected content never acquires a fabricated pass score', () => {
  const state = { pages: [page('https://garyhome.vn/a', 'en', { indexable: false, content: { score: null, findings: [] } })] };
  compareAuditMetadata(state);
  assert.equal(state.pages[0].content.score, null);
});
