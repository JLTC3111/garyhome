import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeFieldError, installFormValidationMessages } from '../lib/form-validation.ts';

const validity = (...flags) => Object.fromEntries(['valid','valueMissing','typeMismatch','patternMismatch','tooShort','tooLong','rangeUnderflow','rangeOverflow','stepMismatch','badInput','customError'].map(key => [key, flags.includes(key)]));
test('validation explains native constraints with the field name, exact limits and full URL examples in both languages', () => {
  for (const [field, english, vietnamese] of [
    [{type:'email',validity:validity('typeMismatch')},/name@example.com/,/địa chỉ email/],
    [{type:'url',validity:validity('typeMismatch')},/https:\/\/www.example.com/,/URL đầy đủ/],
    [{type:'number',min:'0',validity:validity('rangeUnderflow')},/0 or higher/,/từ 0 trở lên/],
    [{type:'number',max:'50',validity:validity('rangeOverflow')},/50 or lower/,/không lớn hơn 50/],
    [{type:'number',min:'1',step:'0.1',validity:validity('stepMismatch')},/0.1.*starting at 1/,/bước 0.1.*từ 1/],
    [{type:'date',max:'2026-11-05',validity:validity('rangeOverflow')},/on or before 2026-11-05/,/không muộn hơn 2026-11-05/],
    [{type:'date',min:'2026-11-05',step:'2',validity:validity('stepMismatch')},/2 days.*2026-11-05/,/2 ngày.*2026-11-05/],
    [{type:'text',minLength:12,validity:validity('tooShort')},/at least 12 characters/,/ít nhất 12 ký tự/],
    [{type:'text',maxLength:180,validity:validity('tooLong')},/no more than 180/,/tối đa 180/],
    [{type:'checkbox',validity:validity('valueMissing')},/confirm this checkbox/,/đánh dấu ô này/],
    [{type:'text',pattern:'[a-z0-9]+(-[a-z0-9]+)*',validity:validity('patternMismatch')},/single hyphens.*apartment-in-tay-ho/,/chữ thường không dấu/],
  ]) {
    assert.match(nativeFieldError({label:'Field',...field},'en'), english);
    assert.match(nativeFieldError({label:'Tên mục',...field},'vi'), vietnamese);
  }
  assert.equal(nativeFieldError({label:'Email',type:'email',validity:validity('valid')},'en'),'');
});

// This fixture exercises the real document listeners and DOM/ARIA lifecycle.
// The browser remains responsible for calculating ValidityState and blocking submit.
function documentFixture() {
  const listeners = new Map(), errors = [];
  const doc = {
    addEventListener(type, handler, capture) { assert.equal(capture,true); listeners.set(type,handler); },
    removeEventListener(type, handler) { if(listeners.get(type)===handler)listeners.delete(type); },
    getElementById() { return null; },
    createElement(tag) {
      assert.equal(tag,'small');
      const node = {id:'',className:'',textContent:'',attributes:{},setAttribute(key,value){this.attributes[key]=value;},remove(){errors.splice(errors.indexOf(this),1);}};
      return node;
    },
  };
  const field = (label, initial = {}) => {
    const attributes = new Map(Object.entries(initial.attributes || {}));
    return {
      tagName:'INPUT',type:'email',validity:validity('typeMismatch'),isConnected:true,tabIndex:0,labels:[{childNodes:[{nodeType:3,textContent:label}]}],title:'',validationMessage:'Please match the requested format.',
      min:'',max:'',step:'',minLength:-1,maxLength:-1,pattern:'',focusCount:0,
      getAttribute(key){return attributes.get(key)??null;},setAttribute(key,value){attributes.set(key,String(value));},removeAttribute(key){attributes.delete(key);},hasAttribute(key){return attributes.has(key);},
      closest(){return null;},insertAdjacentElement(position,node){assert.equal(position,'afterend');errors.push(node);},focus(){this.focusCount++;},...initial,
    };
  };
  const fire = (type, target) => { let prevented=false;listeners.get(type)?.({target,preventDefault(){prevented=true;}});return prevented; };
  return {doc,listeners,errors,field,fire};
}

test('invalid events show persistent translated field errors, focus the first invalid field, and preserve existing hint IDs', async () => {
  const h=documentFixture(),installed=installFormValidationMessages(h.doc);
  const email=h.field('Contact email',{attributes:{'aria-describedby':'email-hint'}}),number=h.field('Bedrooms',{type:'number',min:'0',validity:validity('rangeUnderflow')});
  assert.equal(h.fire('invalid',email),true);assert.equal(h.fire('invalid',number),true);await Promise.resolve();
  assert.equal(email.focusCount,1);assert.equal(number.focusCount,0);assert.equal(h.errors.length,2);
  assert.match(h.errors[0].textContent,/Contact email:.*name@example.com/);assert.equal(email.getAttribute('aria-invalid'),'true');
  assert.match(email.getAttribute('aria-describedby'),/^email-hint gary-field-error-/);
  installed.setLanguage('vi');assert.match(h.errors[0].textContent,/Contact email: nhập địa chỉ email/);
  email.validity=validity('valid');h.fire('input',email);
  assert.equal(h.errors.length,1);assert.equal(email.getAttribute('aria-describedby'),'email-hint');assert.equal(email.getAttribute('aria-invalid'),null);
  installed.destroy();assert.equal(h.errors.length,0);assert.equal(h.listeners.size,0);assert.equal(number.getAttribute('data-form-invalid'),null);
});

test('custom URL components keep their own inline errors and native constraints remain untouched', async () => {
  const h=documentFixture(),installed=installFormValidationMessages(h.doc);
  const url=h.field('Listing URL',{type:'url',validity:validity('customError'),attributes:{'data-validation-managed':'true','aria-describedby':'url-error'}});
  assert.equal(h.fire('invalid',url),true);await Promise.resolve();
  assert.equal(h.errors.length,0);assert.equal(url.getAttribute('aria-describedby'),'url-error');assert.equal(url.validity.customError,true);assert.equal(url.focusCount,1);
  installed.destroy();
});
