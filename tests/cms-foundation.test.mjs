import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyEntry, setValue, safeMediaUrl, validateEntry, contentSeoFindings, fieldsFor } from '../shared/cms-foundation/content.js';
import { cmsText } from '../shared/cms-foundation/copy.js';

test('publishing requires both translations while drafts permit incomplete work', () => {
  const record = {...emptyEntry('article'), slug: 'new-guide', title_en: 'A clear guide'};
  assert.deepEqual(validateEntry(record, {kind: 'article'}), []);
  const issues = validateEntry(record, {kind: 'article'}, true);
  assert.ok(issues.some(issue => issue.code === 'cms-title-missing' && issue.field === 'title_vi'));
  assert.ok(issues.some(issue => issue.code === 'cms-body-missing' && issue.field === 'body_en'));
  assert.ok(issues.every(issue => issue.code && issue.params && issue.severity === 'critical'));
  const taxonomy = {...record, title_vi: 'Cẩm nang rõ ràng', summary_en: 'English', summary_vi: 'Tiếng Việt'};
  assert.deepEqual(validateEntry(taxonomy, {kind: 'category', requireBody: false}, true), []);
});
test('application fields enforce declared types and safe paths without prototype mutation', () => {
  const record = {...emptyEntry('vacancy'), slug: 'role', title_en: 'Teacher', data: {salary: 'NaN', category: 'unlisted', link: 'javascript:alert(1)'}};
  const fields = [{key: 'salary', type: 'number'}, {key: 'category', type: 'select', options: ['school']}, {key: 'link', type: 'url'}];
  assert.equal(validateEntry(record, {fields}).length, 3);
  setValue(record, 'data.salary', 1000); assert.equal(record.data.salary, 1000);
  assert.throws(() => setValue(record, '__proto__.polluted', true)); assert.equal({}.polluted, undefined);
  assert.deepEqual(fieldsFor({fields: [{key: 'eligibility', bilingual: true, type: 'textarea'}]}).map(field => field.key), ['data.eligibility_en', 'data.eligibility_vi']);
  for (const value of ['javascript:alert(1)', 'data:image/svg+xml,bad', '//other.example/a', 'https://name:password@example.com/a', '/\\evil.test/a']) assert.equal(safeMediaUrl(value), '');
  assert.equal(safeMediaUrl('https://example.com/photo.jpg'), 'https://example.com/photo.jpg');
});
test('draft SEO checks return stable language-neutral codes and numeric parameters', () => {
  const record = {...emptyEntry('article'), slug: 'guide', title_en: 'Guide', title_vi: 'Cẩm nang'};
  const findings = contentSeoFindings(record, {});
  assert.ok(findings.every(finding => finding.code && finding.params && finding.severity));
  assert.equal(findings.find(finding => finding.code === 'cms-seo-title-length').params.count, 5);
  assert.ok(!JSON.stringify(findings).includes('recommendation"'));
  assert.notEqual(cmsText('publish', 'en'), cmsText('publish', 'vi'));
});
