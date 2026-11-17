import { attachEditorWorkspace } from '../editor-workspace/index.js';
import { CMS_VERSION, LOCALES, emptyEntry, titleSlug, fieldsFor, getValue, setValue, safeMediaUrl, validateEntry, contentSeoFindings } from './content.js';
import { cmsText, validationText } from './copy.js';
import { localizeFinding } from './seo-findings.js';
export { CMS_VERSION, titleSlug, validateEntry, contentSeoFindings, safeMediaUrl } from './content.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
let serial = 0;

/** Framework-neutral editor. The adapter, never this UI, enforces authorization. */
export function mountCms(root, options) {
  if (!root || !options?.adapter || !options.collections?.length) throw new Error('CMS root, collections and adapter required');
  const adapter = options.adapter, id = `cms-${++serial}`;
  const mediaPolicy = options.mediaPolicy || adapter.mediaPolicy || { mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], maxBytes: 10 * 1024 * 1024 };
  let language = options.language === 'vi' ? 'vi' : 'en', disposed = false, epoch = 0, busy = false;
  let capabilities = { read: false, edit: false, publish: false, media: false };
  let kind = options.collections[0].kind, query = '', status = '', page = 1, total = 0, records = [], media = [], view = 'content';
  let draft = null, baseline = '', revisions = [], notice = '', noticeKind = 'status';
  let editorIssues = [], editorEpoch = 0, editorWorkspace = null;
  const references = new Map(), referenceQueries = new Map(), referenceDrafts = new Map(), referenceCreates = new Map();
  let editorReturnId = null;
  const t = key => cmsText(key, language);
  const label = value => typeof value === 'object' ? value?.[language] || value?.en || '' : value || '';
  const collection = () => options.collections.find(item => item.kind === kind);
  const syncAutomaticSlug = () => { if (draft && collection().automaticSlug && !draft.id) draft.slug = titleSlug(draft); };
  const dirty = () => !!draft && (JSON.stringify(draft) !== baseline || [...referenceDrafts.values()].some(value => ['title_en', 'title_vi', 'summary_en', 'summary_vi'].some(key => String(value[key] || '').trim())));
  const date = value => { try { return value ? new Intl.DateTimeFormat(language === 'vi' ? 'vi-VN' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'; } catch { return '—'; } };
  const disabled = value => value ? ' disabled' : '';
  const button = (action, text, extra = '', off = false) => `<button type="button" data-action="${action}" ${extra}${disabled(off || busy)}>${escape(text)}</button>`;
  function errorText(error) {
    if (['CMS_REVIEW_REQUIRED', 'jobs.review_required'].includes(error?.message)) return t('reviewFirst');
    if (['40001', '409', 'CMS_VERSION_CONFLICT'].includes(String(error?.code))) return t('conflict');
    if (['42501', '401', '403'].includes(String(error?.code))) return t('denied');
    if (['42P01', '42883', 'PGRST202', 'PGRST205', 'CMS_NOT_CONFIGURED'].includes(String(error?.code))) return t('setup');
    if (typeof adapter.errorText === 'function') { const message = adapter.errorText(error, language); if (typeof message === 'string' && message) return message; }
    if (error?.code === '23514') return t('invalid');
    return t('unavailable');
  }
  function announce(text, failed = false) {
    notice = text; noticeKind = failed ? 'alert' : 'status';
    const target = root.querySelector('[data-cms-notice]');
    if (target) { target.textContent = text; target.setAttribute('role', noticeKind); }
    options.onNotice?.(text);
  }
  function canLeave() { return !dirty() || root.ownerDocument.defaultView.confirm(t('discard')); }
  function shell() {
    editorWorkspace?.destroy(); editorWorkspace = null;
    root.classList.add('gary-cms'); root.dataset.cmsApp = options.appId || 'content';
    const tabs = options.collections.map(item => button('collection', label(item.label), `data-kind="${escape(item.kind)}" aria-pressed="${item.kind === kind && view === 'content'}"`)).join('');
    root.innerHTML = `<header class="cms-header"><div><p class="cms-eyebrow">${escape(options.appName || options.appId || 'Gary Group')}</p><h2>${t('cms')}</h2><p>${t(collection().directPublish ? 'vacancyIntro' : 'intro')}</p></div><div class="cms-role">${t('role')}: ${escape(capabilities.role ? t(capabilities.role) : t('readOnly'))}</div></header><p class="cms-notice" data-cms-notice role="${noticeKind}" aria-live="polite">${escape(notice)}</p><nav class="cms-collections" aria-label="${t('content')}">${tabs}${button('media', t('media'), `aria-pressed="${view === 'media'}"`)}</nav><div class="cms-workspace" data-cms-workspace></div><dialog class="cms-dialog" id="${id}-editor" aria-labelledby="${id}-editor-heading"></dialog>`;
    renderWorkspace();
  }
  function renderWorkspace() {
    const target = root.querySelector('[data-cms-workspace]');
    if (!target) return;
    if (!capabilities.read) { target.innerHTML = `<div class="cms-empty" role="status">${escape(busy ? t('loading') : t('noAccess'))}${button('refresh', t('refresh'))}</div>`; return; }
    if (view === 'media') { renderMedia(target); return; }
    target.innerHTML = `<div class="cms-toolbar"><label class="cms-search"><span>${t('search')}</span><input type="search" data-cms-search value="${escape(query)}" maxlength="180"></label><label><span>${t('status')}</span><select data-cms-status><option value="">${t('all')}</option>${['draft', 'review', 'published', 'archived'].map(value => `<option value="${value}"${status === value ? ' selected' : ''}>${t(value)}</option>`).join('')}</select></label>${button('search', t('search'))}${button('refresh', t('refresh'))}${capabilities.edit ? button('new', t('add'), 'class="cms-primary"') : ''}</div><div class="cms-table-scroll" aria-busy="${busy}"><table><caption class="cms-sr">${escape(label(collection().label))}</caption><thead><tr><th scope="col">${t('title')}</th><th scope="col">${t('status')}</th><th scope="col">${t('updated')}</th><th scope="col">${t('actions')}</th></tr></thead><tbody>${records.length ? records.map((record, index) => `<tr><th scope="row"><strong>${escape(record[`title_${language}`] || record.title_en || record.title_vi || record.slug)}</strong><small>${escape(record.slug)}</small></th><td><span class="cms-badge cms-badge-${escape(record.status)}">${escape(t(record.status))}</span></td><td>${escape(date(record.updated_at))}</td><td>${button('edit', t('edit'), `data-index="${index}"`)}</td></tr>`).join('') : `<tr><td colspan="4" class="cms-empty">${escape(busy ? t('loading') : t('empty'))}</td></tr>`}</tbody></table></div><footer class="cms-pagination"><span>${t('results')}: ${total} · ${t('page')} ${page} ${t('of')} ${Math.max(1, Math.ceil(total / 20))}</span><div>${button('previous', t('previous'), '', page <= 1)}${button('next', t('next'), '', page * 20 >= total)}</div></footer>`;
  }
  async function refresh(recheck = false) {
    if (disposed) return;
    const requestEpoch = ++epoch; busy = true; renderWorkspace();
    try {
      if (recheck || !capabilities.read) {
        capabilities = { read: false, edit: false, publish: false, media: false, ...await adapter.capabilities() };
        if (disposed || requestEpoch !== epoch) return;
        if (!capabilities.read) { shell(); return; }
      }
      if (view === 'media') {
        const result = adapter.listMedia ? await adapter.listMedia() : [];
        if (disposed || requestEpoch !== epoch) return;
        media = Array.isArray(result) ? result : result.records || [];
      } else {
        const result = await adapter.list({ kind, query, status, page, pageSize: 20 });
        if (disposed || requestEpoch !== epoch) return;
        records = result.records || []; total = Number(result.total) || 0;
      }
    } catch (error) { if (!disposed && requestEpoch === epoch) announce(errorText(error), true); }
    finally { if (!disposed && requestEpoch === epoch) { busy = false; shell(); } }
  }
  const referenceFields = () => fieldsFor(collection()).filter(item => item.type === 'reference');
  const fold = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
  function referenceChoices(options) { const byValue = new Map(); for (const choice of options) { const existing = byValue.get(String(choice.value)); if (!existing || choice.published && !existing.published) byValue.set(String(choice.value), choice); } return [...byValue.values()]; }
  function referenceField(key, text, extra, controlId) {
    const state = references.get(extra.referenceKind), value = String(getValue(draft, key) ?? '');
    const choices = referenceChoices(state?.options || []), selected = choices.find(item => String(item.value) === value);
    const search = referenceQueries.get(key) || '', term = fold(search);
    const matching = choices.filter(item => !term || fold(`${label(item.label)} ${typeof item.label === 'object' ? Object.values(item.label).join(' ') : ''} ${item.value}`).includes(term));
    const loading = !state || state.status === 'loading', failed = state?.status === 'error';
    const create = referenceCreates.get(key), createError = create?.errorKey === 'invalid' ? t('referenceCreateInvalid') : create?.errorCause ? errorText(create.errorCause) : '', inline = referenceDrafts.get(key) || {}, canCreate = capabilities.publish && !!adapter.createReference;
    const off = !capabilities.edit || busy || loading || failed || !!create?.pending;
    const option = item => `<option value="${escape(item.value)}"${String(item.value) === value ? ' selected' : ''}${item.published ? '' : ' disabled'}>${escape(label(item.label))}${item.published ? '' : ` (${escape(t(item.status || 'draft'))})`}</option>`;
    const unmatched = value && !selected;
    const options = `${unmatched ? `<option value="${escape(value)}" selected disabled>${escape(t('referenceExisting'))}: ${escape(value)}</option>` : ''}${selected && !matching.includes(selected) ? option(selected) : ''}${matching.map(option).join('')}`;
    const hint = loading ? t('referenceLoading') : failed ? t('referenceFailed') : !choices.some(item => item.published) ? t('referenceEmpty') : !matching.length ? t('referenceNoMatch') : unmatched ? t('referenceUnmatched') : '';
    const issue = editorIssues.find(item => item.field === key);
    return `<div class="cms-field cms-reference" data-reference-field="${escape(key)}"><label for="${controlId}">${escape(text)}${extra.required ? ` <small>(${t('required')})</small>` : ''}</label><label class="cms-sr" for="${controlId}-search">${t('referenceSearch')}: ${escape(text)}</label><input id="${controlId}-search" type="search" data-reference-search="${escape(key)}" value="${escape(search)}" placeholder="${t('referenceSearch')}" aria-controls="${controlId}"${disabled(!capabilities.edit || busy || !!create?.pending)}><select id="${controlId}" name="${escape(key)}" data-field="${escape(key)}" aria-describedby="${controlId}-hint ${controlId}-error"${issue ? ' aria-invalid="true"' : ''}${disabled(off)}><option value="">${loading ? t('referenceLoading') : t('referenceChoose')}</option>${options}</select><small id="${controlId}-hint" data-reference-hint role="status">${escape(hint)}</small><small id="${controlId}-error" class="cms-field-error" data-error-for="${escape(key)}" aria-live="polite">${issue ? escape(validationText(issue, language)) : ''}</small>${button('reference-refresh', t('referenceRefresh'), `data-field-key="${escape(key)}"`, loading || !!create?.pending)}${canCreate ? `<details data-reference-create="${escape(key)}"${inline.open || create?.errorKey || create?.errorCause || create?.partialRecord || create?.pending ? ' open' : ''}><summary>${t('referenceCreate')}: ${escape(text)}</summary><p class="cms-hint">${t('referenceCreateIntro')}</p><div class="cms-language-columns">${LOCALES.map(locale => `<section lang="${locale}"><h4>${locale === 'en' ? 'English' : 'Tiếng Việt'}</h4>${['title', 'summary'].map(field => { const name = `${field}_${locale}`, inputId = `${controlId}-create-${name}`; return `<label class="cms-field" for="${inputId}"><span>${t(field)} <small>(${t('required')}, ${field === 'title' ? '3' : '10'}+)</small></span>${field === 'title' ? `<input id="${inputId}" type="text"` : `<textarea id="${inputId}" rows="3"`} data-reference-create-key="${escape(key)}" data-reference-create-field="${name}" minlength="${field === 'title' ? 3 : 10}" maxlength="${field === 'title' ? 200 : 2000}"${disabled(busy || !!create?.pending)}>${field === 'title' ? '' : escape(inline[name] || '')}${field === 'title' ? '' : '</textarea>'}</label>`; }).join('')}</section>`).join('')}</div>${create?.partialRecord ? `<p class="cms-alert" role="status">${t('referencePartial')}</p>` : ''}<p data-reference-create-notice role="${createError ? 'alert' : 'status'}">${escape(createError || (create?.created ? t('referenceCreated') : ''))}</p>${button('reference-create', create?.pending ? t('referenceCreating') : t('referenceCreateAction'), `data-field-key="${escape(key)}"`, !!create?.pending)}</details>` : ''}</div>`;
  }
  function renderReference(key) {
    if (!draft || disposed) return;
    const definition = referenceFields().find(item => item.key === key), current = [...root.querySelectorAll('[data-reference-field]')].find(item => item.dataset.referenceField === key);
    if (!definition || !current) return;
    const active = root.ownerDocument.activeElement, focusedSearch = active?.dataset.referenceSearch === key, focusedSelect = active?.dataset.field === key;
    const focusedCreate = active?.dataset.referenceCreateKey === key ? active.dataset.referenceCreateField : null;
    const selection = focusedSearch || focusedCreate ? [active.selectionStart, active.selectionEnd] : null;
    const container = root.ownerDocument.createElement('div');
    container.innerHTML = referenceField(key, label(definition.label), definition, `${id}-${key.replace(/[^a-z0-9]/gi, '-')}`);
    const next = container.firstElementChild; current.replaceWith(next);
    // Input values are set as properties instead of embedding authored text in HTML.
    for (const control of next.querySelectorAll('input[data-reference-create-field]')) control.value = referenceDrafts.get(key)?.[control.dataset.referenceCreateField] || '';
    if (focusedSearch || focusedCreate || focusedSelect) {
      const control = focusedSearch ? next.querySelector('[data-reference-search]') : focusedSelect ? next.querySelector('[data-field]') : [...next.querySelectorAll('[data-reference-create-field]')].find(item => item.dataset.referenceCreateField === focusedCreate);
      control?.focus(); if (selection && control?.setSelectionRange) try { control.setSelectionRange(...selection); } catch {}
    }
  }
  async function loadReference(kind, force = false) {
    const previous = references.get(kind);
    if (previous?.status === 'loading') return previous.promise;
    if (!force && previous?.status === 'ready') return previous.options;
    const state = {status: 'loading', options: previous?.options || []}; references.set(kind, state);
    for (const field of referenceFields().filter(item => item.referenceKind === kind)) renderReference(field.key);
    state.promise = (async () => {
      try {
        if (!adapter.referenceOptions) throw new Error('Reference adapter unavailable');
        const options = await adapter.referenceOptions(kind);
        if (disposed || references.get(kind) !== state) return [];
        state.options = referenceChoices(Array.isArray(options) ? options : []); state.status = 'ready';
      } catch { if (!disposed && references.get(kind) === state) state.status = 'error'; }
      if (!disposed && references.get(kind) === state) for (const field of referenceFields().filter(item => item.referenceKind === kind)) renderReference(field.key);
      return state.options;
    })();
    return state.promise;
  }
  async function loadReferences(force = false) { await Promise.all([...new Set(referenceFields().map(item => item.referenceKind))].map(kind => loadReference(kind, force))); }
  function referenceIssues() {
    return referenceFields().flatMap(field => {
      const value = String(getValue(draft, field.key) || ''), state = references.get(field.referenceKind), selected = state?.options?.find(item => String(item.value) === value);
      const code = !value ? 'jobs-reference-required' : state?.status !== 'ready' ? 'jobs-reference-lookup-failed' : !selected ? 'jobs-reference-unavailable' : !selected.published ? 'jobs-reference-unpublished' : null;
      return code ? [{code, field: field.key, params: {kind: field.referenceKind, value}, severity: 'critical'}] : [];
    });
  }
  async function createReference(key) {
    const field = referenceFields().find(item => item.key === key);
    if (!field || !capabilities.publish || !adapter.createReference || referenceCreates.get(key)?.pending || busy) return;
    const values = referenceDrafts.get(key) || {}, record = Object.fromEntries(['title_en', 'title_vi', 'summary_en', 'summary_vi'].map(name => [name, String(values[name] || '').trim()]));
    const missing = Object.keys(record).find(name => [...record[name]].length < (name.startsWith('title_') ? 3 : 10));
    if (missing) {
      referenceCreates.set(key, {...referenceCreates.get(key), errorKey: 'invalid'}); renderReference(key);
      [...root.querySelectorAll('[data-reference-create-field]')].find(item => item.dataset.referenceCreateKey === key && item.dataset.referenceCreateField === missing)?.focus(); return;
    }
    const previous = referenceCreates.get(key), token = editorEpoch;
    referenceCreates.set(key, {...previous, pending: true, errorKey: null, errorCause: null, created: false}); renderReference(key);
    try {
      const next = await adapter.createReference(field.referenceKind, {...record, ...(previous?.partialRecord ? {id: previous.partialRecord.id, version: previous.partialRecord.version} : {})});
      if (disposed || token !== editorEpoch || !draft) return;
      if (!next?.slug || next.status !== 'published') throw Object.assign(new Error('Reference was not published'), {partialRecord: next});
      referenceDrafts.delete(key); referenceCreates.set(key, {created: true});
      await loadReference(field.referenceKind, true);
      if (disposed || token !== editorEpoch || !draft) return;
      setValue(draft, key, next.slug); editorIssues = editorIssues.filter(issue => issue.field !== key); renderReference(key); updateEditorChecks(); renderIssueSummary();
      [...root.querySelectorAll('[data-field]')].find(item => item.dataset.field === key)?.focus();
    } catch (error) {
      if (disposed || token !== editorEpoch || !draft) return;
      referenceCreates.set(key, {errorCause: error, partialRecord: error.partialRecord || previous?.partialRecord}); renderReference(key);
    }
  }
  function field(key, text, type = 'text', extra = {}) {
    const value = getValue(draft, key) ?? '', controlId = `${id}-${key.replace(/[^a-z0-9]/gi, '-')}`;
    if (type === 'reference') return referenceField(key, text, extra, controlId);
    const attributes = `id="${controlId}" name="${escape(key)}" data-field="${escape(key)}" aria-describedby="${controlId}-error"${extra.locale ? ` lang="${extra.locale}"` : ''}${extra.minLength !== undefined ? ` minlength="${Number(extra.minLength)}"` : ''}${disabled(!capabilities.edit || busy)}`;
    let control;
    if (type === 'textarea' || type === 'list') control = `<textarea ${attributes} rows="${type === 'list' ? 4 : key.startsWith('body_') ? 10 : 3}" maxlength="50000"${type === 'list' ? ' data-list="true"' : ''}>${escape(Array.isArray(value) ? value.join('\n') : value)}</textarea>`;
    else if (type === 'select') control = `<select ${attributes}><option value="">—</option>${value && !(extra.options || []).some(option => String(typeof option === 'object' ? option.value : option) === String(value)) ? `<option value="${escape(value)}" selected${extra.preservePublished && draft.published_at && !extra.excludedValues?.includes(String(value)) ? '' : ' disabled'}>${escape(value)} (${t('previousValue')})</option>` : ''}${(extra.options || []).map(option => { const v = typeof option === 'object' ? option.value : option; return `<option value="${escape(v)}"${String(v) === String(value) ? ' selected' : ''}>${escape(typeof option === 'object' ? label(option.label || option.value) : option)}</option>`; }).join('')}</select>`;
    else control = `<input ${attributes} type="${['number', 'date', 'url', 'email'].includes(type) ? type : 'text'}" value="${escape(value)}"${extra.min !== undefined ? ` min="${Number(extra.min)}"` : ''}${extra.max !== undefined ? ` max="${Number(extra.max)}"` : ''}${type === 'date' && extra.minDate ? ` min="${extra.minDate === 'today' ? new Date().toISOString().slice(0, 10) : escape(extra.minDate)}"` : ''}${type !== 'number' && type !== 'date' ? ` maxlength="${Number(extra.maxLength || 2000)}"` : ''}>`;
    return `<label class="cms-field" for="${controlId}"><span>${escape(text)}${extra.required ? ` <small>(${t('required')})</small>` : ''}</span>${control}<small id="${controlId}-error" class="cms-field-error" data-error-for="${escape(key)}" aria-live="polite"></small></label>`;
  }
  function editor() {
    const dialog = root.querySelector('.cms-dialog');
    if (!dialog || !draft) return;
    const extraFields = fieldsFor(collection());
    const textRequired = key => collection().publishTextFields?.includes(key);
    const textLabel = (key, locale) => t(key) + (collection().publishTextFields && !textRequired(`${key}_${locale}`) ? ` (${t('optional')})` : '');
    dialog.innerHTML = `<header><div><p class="cms-eyebrow">${escape(label(collection().label))}</p><h2 id="${id}-editor-heading">${escape(draft.id ? t('edit') : t('add'))}</h2></div>${button('close', t('close'))}</header><form data-cms-editor novalidate><div class="cms-editor-body gw-editor-body" data-gw-body><div data-editor-errors></div><div class="cms-editor-meta">${collection().automaticSlug ? '<p class="cms-hint" data-cms-auto-url></p>' : field('slug', t('slug'))}<p><span class="cms-badge cms-badge-${escape(draft.status)}">${t(draft.status)}</span> · <span data-cms-dirty>${t('clean')}</span></p></div><p class="cms-hint">${t(collection().directPublish ? 'vacancyHint' : 'snapshot')}</p><div class="cms-language-columns">${LOCALES.map(locale => `<section lang="${locale}" aria-label="${locale === 'en' ? 'English' : 'Tiếng Việt'}"><h3>${locale === 'en' ? 'English' : 'Tiếng Việt'}</h3>${field(`title_${locale}`, textLabel('title', locale), 'text', { locale, required: textRequired(`title_${locale}`) })}${field(`summary_${locale}`, textLabel('summary', locale), 'textarea', { locale, required: textRequired(`summary_${locale}`) })}${field(`body_${locale}`, textLabel('body', locale), 'textarea', { locale, required: textRequired(`body_${locale}`) })}${extraFields.filter(item => item.locale === locale).map(item => field(item.key, label(item.label), item.type, item)).join('')}<details><summary>${t('seo')}</summary>${field(`seo_title_${locale}`, t('seoTitle'), 'text', { locale })}${field(`seo_description_${locale}`, t('seoDescription'), 'textarea', { locale })}</details></section>`).join('')}</div>${extraFields.filter(item => !item.locale).map(item => field(item.key, label(item.label), item.type, item)).join('')}<details class="cms-seo"><summary>${t('seo')}</summary><p class="cms-hint">${t('advisory')}</p><div data-cms-checks></div></details><details class="cms-preview"><summary>${t('preview')}</summary><div class="cms-language-columns" data-cms-preview></div></details><details data-cms-revisions><summary>${t('revision')}</summary><div data-cms-history><p>${t('loadingRevisions')}</p></div></details><p class="cms-dialog-notice" data-editor-notice role="status" aria-live="polite"></p></div><footer class="cms-editor-actions gw-editor-actions" data-gw-actions>${capabilities.edit ? `<button type="submit" class="cms-primary"${disabled(busy)}>${t('save')}</button>${!collection().directPublish || !capabilities.publish ? button('review', t('submit'), '', !draft.id) : ''}` : ''}${capabilities.publish ? `${button('publish', t('publish'), '', !collection().directPublish && (!draft.id || draft.status !== 'review'))}${button('archive', t('archive'), '', !draft.id || draft.status === 'archived')}` : ''}${button('close', t('cancel'))}</footer></form>`;
    if (!editorWorkspace) editorWorkspace = attachEditorWorkspace(dialog, {key: `${options.appId || 'content'}:cms:${kind}`, language: () => language});
    editorWorkspace.refresh();
    for (const control of dialog.querySelectorAll('input[data-reference-create-field]')) control.value = referenceDrafts.get(control.dataset.referenceCreateKey)?.[control.dataset.referenceCreateField] || '';
    updateEditorChecks(); renderHistory(); showIssues(editorIssues, {focus: false});
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); } else dialog.setAttribute('open', '');
    dialog.querySelector('input')?.focus();
  }
  function updateEditorChecks() {
    if (!draft) return;
    syncAutomaticSlug();
    const automaticUrl = root.querySelector('[data-cms-auto-url]');
    if (automaticUrl) automaticUrl.textContent = draft.slug && collection().publicPath ? `${t('automaticUrl')}: ${collection().publicPath}${draft.slug}` : t('automaticUrlPending');
    const target = root.querySelector('[data-cms-checks]');
    if (target) target.innerHTML = contentSeoFindings(draft, collection()).map(finding => { const translated = localizeFinding(finding, language); return `<article class="cms-finding cms-${finding.severity}"><strong>${escape(t(finding.severity))}: ${escape(translated.title)}</strong><p>${escape(translated.recommendation || translated.explanation)}</p></article>`; }).join('');
    const preview = root.querySelector('[data-cms-preview]');
    if (preview) preview.innerHTML = LOCALES.map(locale => `<article lang="${locale}"><h3>${escape(draft[`title_${locale}`] || draft.title_en || t('noPreview'))}</h3><p>${escape(draft[`summary_${locale}`] || draft.summary_en || '')}</p><div class="cms-plain-content">${escape(draft[`body_${locale}`] || draft.body_en || '')}</div></article>`).join('');
    const dirtyState = root.querySelector('[data-cms-dirty]'); if (dirtyState) dirtyState.textContent = t(dirty() ? 'changed' : 'clean');
  }
  async function openEditor(record) {
    if (!canLeave()) return;
    editorReturnId = record?.id || null;
    const openingEpoch = ++editorEpoch; editorIssues = []; referenceQueries.clear(); referenceDrafts.clear(); referenceCreates.clear();
    draft = structuredClone(record || emptyEntry(kind)); draft.data ||= {};
    baseline = JSON.stringify(draft);
    if (adapter.prepare) {
      const candidate = draft, preparingState = JSON.stringify(candidate);
      let prepared;
      try { prepared = await adapter.prepare(candidate); }
      catch (error) { if (!disposed && openingEpoch === editorEpoch) announce(errorText(error), true); return; }
      if (disposed || openingEpoch !== editorEpoch || draft !== candidate || JSON.stringify(draft) !== preparingState) return;
      draft = prepared;
    }
    syncAutomaticSlug();
    baseline = JSON.stringify(draft); revisions = []; editor(); void loadReferences(true);
    if (draft.id && adapter.revisions) {
      const selected = draft.id;
      try { const result = await adapter.revisions(selected); if (!disposed && draft?.id === selected) { revisions = Array.isArray(result) ? result : result.records || []; renderHistory(); } }
      catch (error) { if (draft?.id === selected) editorNotice(errorText(error)); }
    }
  }
  function editorNotice(text) { const target = root.querySelector('[data-editor-notice]'); if (target) { target.textContent = text; target.setAttribute('role', 'alert'); } }
  function renderHistory() {
    const target = root.querySelector('[data-cms-history]'); if (!target) return;
    target.innerHTML = revisions.length ? revisions.map((revision, index) => `<div class="cms-revision"><span>${escape(date(revision.created_at))} · v${escape(revision.version || index + 1)} · ${escape(t(revision.status || 'draft'))}</span>${capabilities.edit ? button('restore', t('restore'), `data-index="${index}"`) : ''}</div>`).join('') : `<p>${t('revisionsEmpty')}</p>`;
  }
  function focusField(key) {
    const control = [...root.querySelectorAll('[data-field]')].find(item => item.dataset.field === key);
    if (!control) return;
    let parent = control.parentElement; while (parent && parent !== root) { if (parent.tagName === 'DETAILS') parent.open = true; parent = parent.parentElement; }
    const target = control.disabled ? control.closest('[data-reference-field]')?.querySelector('button[data-action="reference-refresh"]:not([disabled]), input[data-reference-search]:not([disabled])') || control : control;
    target.scrollIntoView?.({block: 'center'}); target.focus();
  }
  function renderIssueSummary() {
    const target = root.querySelector('[data-editor-errors]'); if (!target) return;
    target.innerHTML = editorIssues.length ? `<div class="cms-validation-summary" role="alert"><strong>${t('validationSummary')}</strong><ul>${editorIssues.map(issue => {
      const definition = fieldsFor(collection()).find(item => item.key === issue.field), fieldLabel = definition ? label(definition.label) : t(issue.field.split('_')[0]);
      return `<li><button type="button" data-action="focus-issue" data-field-key="${escape(issue.field)}">${escape(fieldLabel)}: ${escape(validationText(issue, language))}</button></li>`;
    }).join('')}</ul></div>` : '';
  }
  function showIssues(issues, {focus = true} = {}) {
    editorIssues = issues || [];
    for (const target of root.querySelectorAll('[data-error-for]')) target.textContent = '';
    for (const control of root.querySelectorAll('[data-field]')) control.removeAttribute('aria-invalid');
    for (const issue of editorIssues) {
      const target = [...root.querySelectorAll('[data-error-for]')].find(item => item.dataset.errorFor === issue.field);
      if (target) target.textContent = validationText(issue, language);
      const control = [...root.querySelectorAll('[data-field]')].find(item => item.dataset.field === issue.field);
      control?.setAttribute('aria-invalid', 'true');
    }
    renderIssueSummary();
    if (editorIssues.length) { editorNotice(t('invalid')); if (focus) focusField(editorIssues[0].field); }
    return editorIssues.length > 0;
  }
  async function mutate(operation, success) {
    if (busy || !draft) return;
    busy = true;
    const controls = [...root.querySelectorAll('.cms-dialog button, .cms-dialog input, .cms-dialog textarea, .cms-dialog select')].map(control => [control, control.disabled]);
    for (const [control] of controls) control.disabled = true;
    let failedIssues = null;
    try {
      const next = await operation();
      if (disposed) return;
      if (!next?.id || !Number.isFinite(Number(next.version))) throw new Error('Invalid content response');
      draft = structuredClone(next); draft.data ||= {}; baseline = JSON.stringify(draft); editorIssues = [];
      announce(success); busy = false; editor(); editorNotice(success);
      if (adapter.revisions) { const selected = draft.id; const result = await adapter.revisions(selected); if (draft?.id === selected) { revisions = Array.isArray(result) ? result : result.records || []; renderHistory(); } }
    } catch (error) { if (!disposed) { if (error.partialRecord?.id) { draft = structuredClone(error.partialRecord); baseline = JSON.stringify(draft); busy = false; editor(); } failedIssues = Array.isArray(error.issues) ? error.issues : null; editorNotice(errorText(error)); options.onNotice?.(errorText(error)); } }
    finally { if (!disposed) { busy = false; for (const [control, wasDisabled] of controls) if (control.isConnected) control.disabled = wasDisabled; for (const field of referenceFields()) renderReference(field.key); if (failedIssues) showIssues(failedIssues); } }
  }
  function renderMedia(target) {
    const policyText = `${mediaPolicy.mimeTypes.map(type => type.split('/')[1].toUpperCase()).join(', ')} · ${Math.round(mediaPolicy.maxBytes / 1024 / 1024)} MB`;
    target.innerHTML = `<div class="cms-toolbar"><h3>${t('media')}</h3>${button('refresh', t('refresh'))}</div>${capabilities.media && adapter.uploadMedia ? `<form data-cms-upload><p>${escape(policyText)}</p><label class="cms-field"><span>${t('file')}</span><input type="file" name="file" accept="${escape(mediaPolicy.mimeTypes.join(','))}" required></label>${['en', 'vi'].map(locale => `<label class="cms-field"><span>${t(locale === 'en' ? 'altEn' : 'altVi')}</span><input name="alt_${locale}" lang="${locale}" maxlength="500"></label>`).join('')}<p class="cms-hint">${t('altHint')}</p><button type="submit"${disabled(busy)}>${t('upload')}</button></form>` : ''}<div class="cms-media-grid">${media.length ? media.map((item, index) => { const url = safeMediaUrl(item.url || item.public_url || item.signed_url || ''); return `<article>${url && /^image\//.test(item.mime_type || item.type || '') ? `<img src="${escape(url)}" alt="${escape(item[`alt_${language}`] || item.alt || item.filename || item.file_name || '')}" loading="lazy">` : ''}<strong>${escape(item.filename || item.file_name || item.name || item.path || item.object_path || '')}</strong><p>${escape(item[`alt_${language}`] || '')}</p>${url ? `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${t('open')}</a>${button('copy-media', t('useMedia'), `data-index="${index}"`)}` : ''}</article>`; }).join('') : `<p>${t('mediaEmpty')}</p>`}</div>`;
  }
  function restoreEditorFocus() {
    const index = records.findIndex(record => record.id === editorReturnId);
    const target = index >= 0 ? root.querySelector(`[data-action="edit"][data-index="${index}"]`) : root.querySelector('[data-action="new"]');
    (target || root.querySelector('[data-action="refresh"]'))?.focus();
  }
  async function onClick(event) {
    const target = event.target.closest('[data-action]'); if (!target || !root.contains(target) || target.disabled || busy) return;
    event.stopPropagation?.();
    const action = target.dataset.action;
    if (action === 'focus-issue') { focusField(target.dataset.fieldKey); return; }
    if (action === 'reference-refresh') { const field = referenceFields().find(item => item.key === target.dataset.fieldKey); if (field) await loadReference(field.referenceKind, true); return; }
    if (action === 'reference-create') return createReference(target.dataset.fieldKey);
    if (action === 'close') { if (!canLeave()) return; ++editorEpoch; draft = null; baseline = ''; root.querySelector('.cms-dialog')?.close?.(); await refresh(); restoreEditorFocus(); return; }
    if (action === 'edit') return openEditor(records[Number(target.dataset.index)]);
    if (action === 'new') { if (capabilities.edit) return openEditor(); return; }
    if (action === 'collection' || action === 'media') {
      if (!canLeave()) return; ++editorEpoch; draft = null; baseline = ''; query = ''; page = 1;
      if (action === 'collection') { kind = target.dataset.kind; view = 'content'; } else view = 'media';
      shell(); return refresh();
    }
    if (action === 'search') { query = root.querySelector('[data-cms-search]')?.value || ''; page = 1; return refresh(); }
    if (action === 'refresh') return refresh(true);
    if (action === 'previous' || action === 'next') { page += action === 'previous' ? -1 : 1; return refresh(); }
    if (action === 'publish' && collection().directPublish) {
      if (!draft || !capabilities.edit || !capabilities.publish) return;
      syncAutomaticSlug();
      if (showIssues(validateEntry(draft, collection(), true))) return;
      const payload = structuredClone(draft), publicationEpoch = editorEpoch, needsSave = dirty() || !draft.id;
      return mutate(async () => {
        const issues = adapter.validatePublication ? await adapter.validatePublication(payload) : [];
        if (issues.length) throw Object.assign(new Error('Publication validation failed'), {issues});
        if (disposed || publicationEpoch !== editorEpoch) throw new Error('Editor changed before publication');
        let saved = payload;
        try {
          if (needsSave) saved = await adapter.save(payload, {expectedVersion: payload.version});
          return await adapter.transition(saved.id, 'published', {expectedVersion: saved.version});
        } catch (error) { if (saved.id && saved !== payload) error.partialRecord = saved; throw error; }
      }, t('vacancyPublished'));
    }
    if (['publish', 'archive', 'review'].includes(action)) {
      if (!draft?.id || !(action === 'review' ? capabilities.edit : capabilities.publish)) return;
      if (dirty()) { editorNotice(t('saveFirst')); return; }
      if (action === 'publish' && draft.status !== 'review') { editorNotice(t('reviewFirst')); return; }
      if (['publish', 'review'].includes(action) && showIssues(validateEntry(draft, collection(), true))) return;
      if (action !== 'review' && !root.ownerDocument.defaultView.confirm(t(action === 'publish' ? 'publishConfirm' : 'archiveConfirm'))) return;
      const publicationRecord = structuredClone(draft), publicationEpoch = editorEpoch;
      return mutate(async () => {
        if (['publish', 'review'].includes(action)) {
          await loadReferences(true);
          const backendIssues = adapter.validatePublication ? await adapter.validatePublication(publicationRecord) : [];
          const issues = [...backendIssues, ...referenceIssues().filter(issue => !backendIssues.some(item => item.field === issue.field))];
          if (issues.length) throw Object.assign(new Error('Publication validation failed'), {issues});
        }
        if (disposed || publicationEpoch !== editorEpoch || !draft || draft.id !== publicationRecord.id) throw new Error('Editor changed before publication');
        return adapter.transition(publicationRecord.id, action === 'publish' ? 'published' : action === 'archive' ? 'archived' : 'review', { expectedVersion: publicationRecord.version });
      }, t('transitioned'));
    }
    if (action === 'restore') {
      if (!capabilities.edit || !canLeave() || !root.ownerDocument.defaultView.confirm(t('restoreConfirm'))) return;
      const revision = revisions[Number(target.dataset.index)];
      if (revision) return mutate(() => adapter.restore(draft.id, revision.id, { expectedVersion: draft.version }), t('restored'));
    }
    if (action === 'copy-media') {
      const item = media[Number(target.dataset.index)], url = safeMediaUrl(item?.url || item?.public_url || item?.signed_url || ''); if (!url) return;
      try { await root.ownerDocument.defaultView.navigator.clipboard.writeText(url); announce(t('copied')); } catch { announce(t('copyFailed') + ' ' + url); }
    }
  }
  async function onSubmit(event) {
    if (event.target.matches('[data-cms-editor]')) {
      event.preventDefault(); event.stopPropagation();
      if (!draft || !capabilities.edit) return;
      syncAutomaticSlug();
      if (showIssues(validateEntry(draft, collection()))) return;
      const payload = structuredClone(draft); return mutate(() => adapter.save(payload, { expectedVersion: draft.version }), t('saved'));
    }
    if (event.target.matches('[data-cms-upload]')) {
      event.preventDefault(); event.stopPropagation(); if (!capabilities.media || busy) return;
      const form = event.target, file = form.elements.file.files?.[0];
      if (!file || file.size <= 0 || file.size > mediaPolicy.maxBytes || !mediaPolicy.mimeTypes.includes(file.type)) { announce(t('invalid') + ' ' + `${Math.round(mediaPolicy.maxBytes / 1024 / 1024)} MB`, true); return; }
      if (file.type.startsWith('image/') && (!form.elements.alt_en.value.trim() || !form.elements.alt_vi.value.trim())) { announce(t('altHint'), true); return; }
      busy = true; form.querySelector('button').disabled = true;
      try { await adapter.uploadMedia(file, { alt_en: form.elements.alt_en.value.trim(), alt_vi: form.elements.alt_vi.value.trim() }); announce(t('mediaSaved')); }
      catch (error) { announce(errorText(error), true); }
      finally { busy = false; await refresh(); }
    }
  }
  function onInput(event) {
    if (draft && event.target.dataset.referenceSearch) { referenceQueries.set(event.target.dataset.referenceSearch, event.target.value); renderReference(event.target.dataset.referenceSearch); return; }
    if (draft && event.target.dataset.referenceCreateKey) {
      const key = event.target.dataset.referenceCreateKey, values = referenceDrafts.get(key) || {};
      values[event.target.dataset.referenceCreateField] = event.target.value; values.open = true; referenceDrafts.set(key, values); return;
    }
    if (draft && event.target.dataset.field) {
      let value = event.target.value;
      if (event.target.dataset.list) value = value.split('\n').map(item => item.trim()).filter(Boolean);
      else if (event.target.type === 'number' && value !== '') value = Number(value);
      const key = event.target.dataset.field; setValue(draft, key, value); editorIssues = editorIssues.filter(issue => issue.field !== key);
      const error = [...root.querySelectorAll('[data-error-for]')].find(item => item.dataset.errorFor === key); if (error) error.textContent = ''; event.target.removeAttribute('aria-invalid');
      if (referenceFields().some(item => item.key === key)) renderReference(key); updateEditorChecks(); renderIssueSummary();
    }
  }
  function onToggle(event) { if (draft && root.contains(event.target) && event.target.dataset.referenceCreate) { const key = event.target.dataset.referenceCreate, values = referenceDrafts.get(key) || {}; values.open = event.target.open; referenceDrafts.set(key, values); } }
  function onChange(event) {
    if (event.target.matches('[data-cms-status]')) { status = event.target.value; page = 1; void refresh(); }
    else if (event.target.dataset.field) onInput(event);
  }
  function onKey(event) { if (event.key === 'Enter' && event.target.matches('[data-cms-search]')) { event.preventDefault(); query = event.target.value; page = 1; void refresh(); } }
  function onCancel(event) { if (event.target.matches('.cms-dialog')) { event.preventDefault(); void onClick({ target: { closest: () => root.querySelector('[data-action="close"]') } }); } }
  function beforeUnload(event) { if (dirty()) { event.preventDefault(); event.returnValue = ''; } }
  root.addEventListener('click', onClick); root.addEventListener('submit', onSubmit); root.addEventListener('input', onInput); root.addEventListener('change', onChange); root.addEventListener('keydown', onKey); root.addEventListener('cancel', onCancel, true); root.addEventListener('toggle', onToggle, true);
  root.ownerDocument.defaultView.addEventListener('beforeunload', beforeUnload);
  shell();
  const ready = refresh(true);
  return {
    ready, isDirty: dirty, canLeave,
    async refresh() { if (!canLeave()) return false; ++editorEpoch; draft = null; baseline = ''; await refresh(true); return true; },
    setLanguage(value) { language = value === 'vi' ? 'vi' : 'en'; if (draft) { const previous = draft; shell(); draft = previous; editor(); } else shell(); },
    destroy({ force = false } = {}) {
      if (!force && !canLeave()) return false;
      editorWorkspace?.destroy(); editorWorkspace = null;
      disposed = true; ++epoch; ++editorEpoch; draft = null; records = []; media = []; references.clear(); referenceQueries.clear(); referenceDrafts.clear(); referenceCreates.clear(); editorIssues = [];
      root.removeEventListener('click', onClick); root.removeEventListener('submit', onSubmit); root.removeEventListener('input', onInput); root.removeEventListener('change', onChange); root.removeEventListener('keydown', onKey); root.removeEventListener('cancel', onCancel, true); root.removeEventListener('toggle', onToggle, true); root.ownerDocument.defaultView.removeEventListener('beforeunload', beforeUnload);
      root.replaceChildren(); root.classList.remove('gary-cms'); delete root.dataset.cmsApp; return true;
    }
  };
}
