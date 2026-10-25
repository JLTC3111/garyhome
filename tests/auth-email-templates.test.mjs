import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('Gary Home invitation and recovery messages provide one safe, bilingual password action',async()=>{
 for(const [file,type] of [['invite','invite'],['recovery','recovery']]){
  const html=await readFile(new URL('../supabase/templates/'+file+'.html',import.meta.url),'utf8');
  const anchors=[...html.matchAll(/<a\s+href="([^"]+)"/g)];assert.equal(anchors.length,1);
  assert.ok(anchors[0][1].includes('#token_hash={{ .TokenHash }}&amp;type='+type));
  assert.ok(anchors[0][1].includes('{{ .RedirectTo }}'));assert.ok(anchors[0][1].includes('{{ .SiteURL }}'));
  assert.match(html,/lang="vi"/);assert.match(html,/Continue to set password/);assert.match(html,/Lưu mật khẩu/);assert.match(html,/{{ .Email }}/);
  assert.doesNotMatch(html,/https?:\/\/|\.ConfirmationURL|\b24 hours\b/);
 }
});
