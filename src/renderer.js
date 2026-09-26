const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const shapes = {
  orbit: '<ellipse cx="12" cy="12" rx="11" ry="5" transform="rotate(-35 12 12)"/><circle cx="12" cy="12" r="5"/><circle cx="21" cy="6" r="1"/>',
  home: '<path d="m3 10 9-7 9 7v10H3zM9 20v-7h6v7"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2 6-6 2 2-6z"/>',
  sliders: '<path d="M4 3v18M12 3v18M20 3v18"/><rect x="2" y="6" width="4" height="4"/><rect x="10" y="14" width="4" height="4"/><rect x="18" y="8" width="4" height="4"/>',
  refresh: '<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>',
  play: '<path d="m8 4 12 8-12 8z"/>',
  folder: '<path d="M3 7V4h6l3 3h9v13H3z"/>',
  file: '<path d="M5 2h9l5 5v15H5zM14 2v6h5M8 12h8M8 16h8"/>',
  archive: '<path d="M4 8h16v13H4zM2 3h20v5H2zM9 12h6"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/>',
  ruler: '<path d="m3 16 13-13 5 5L8 21zM7 12l2 2M10 9l2 2M13 6l2 2"/>',
  route: '<circle cx="5" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><path d="M7 5h9a4 4 0 0 1 0 8H8a3 3 0 0 0 0 6h9"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/>',
  camera: '<path d="M3 7h4l2-3h6l2 3h4v13H3z"/><circle cx="12" cy="13" r="4"/>'
};
function icon(name) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (shapes[name] || shapes.grid) + '</svg>'; }
$$('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon));
let state, category = 'All', query = '', working = false, toastTimer;
function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}
function button(text, className, action) {
  const el = node('button', className, text);
  el.onclick = action;
  return el;
}
function toast(text, error = false) {
  const el = $('#toast'); el.textContent = text;
  el.className = error ? 'show error' : 'show';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.className = '', error ? 9000 : 4200);
}
function page(id) {
  $$('.page').forEach(el => el.classList.toggle('active', el.id === id));
  $$('.nav-item').forEach(el => { const active = el.dataset.page === id; el.classList.toggle('active', active); el.setAttribute('aria-current', active ? 'page' : 'false'); });
  $('#crumb').textContent = {home:'Overview',discover:'Discover mods',library:'Your library',settings:'Settings'}[id];
  window.scrollTo(0, 0);
}
async function action(fn, message) {
  if (working) return;
  working = true; document.body.setAttribute('aria-busy', 'true');
  try { const result = await fn(); if (message && result !== false) toast(message); }
  catch (error) { toast(error.message.replace(/^Error invoking remote method '[^']+': Error: /, ''), true); }
  finally { working = false; document.body.removeAttribute('aria-busy'); await refresh(); }
}
async function refresh() {
  try {
    state = await window.ksa.state();
    $('#platform').textContent = state.platform + ' / v' + state.version;
    $('#version').textContent = state.version;
    $('#enabled-count').textContent = state.enabled.length;
    $('#library-count').textContent = state.mods.length;
    $('#game-status').textContent = state.running ? 'In flight' : state.problem ? 'Setup needed' : 'Ready to launch';
    $('#gpu-status').textContent = state.gpu === 'Auto-detect' ? 'Auto · ' + state.effectiveGPU : state.gpu;
    $('#launch-caption').textContent = state.problem || (state.running ? 'KSA is running. Have a good flight.' : state.enabled.length + ' mods enabled · ' + (state.enabled.length ? 'StarMap launch' : 'Vanilla launch'));
    $$('.launch').forEach(el => el.disabled = !state.ready);
    $$('.close-game').forEach(el => el.disabled = !state.running);
    $('#setup-notice').hidden = !state.problem;
    $('#setup-notice').textContent = state.problem;
    $('#gpu').value = state.gpu;
    renderCards();
    renderLibrary();
    renderSettings();
  } catch (error) { toast('Could not read your setup: ' + error.message, true); }
}
function preview(mod, className, eager = false) {
  const art = node('div', className);
  const fallback = () => {
    art.classList.remove('has-image', 'logo-preview');
    art.innerHTML = icon(mod.glyph);
    art.append(node('span', 'preview-placeholder', 'Preview unavailable'));
  };
  if (!mod.preview) { fallback(); return art; }
  art.classList.add('has-image');
  if (mod.preview.fit === 'contain') art.classList.add('logo-preview');
  const img = node('img', 'mod-preview');
  img.alt = mod.preview.alt;
  img.loading = eager ? 'eager' : 'lazy';
  img.decoding = 'async';
  img.onerror = fallback;
  img.src = '../assets/mods/' + mod.preview.file;
  art.append(img);
  return art;
}
function modCard(mod) {
  const el = node('article', 'mod-card'), art = button('', 'preview-button', () => detail(mod));
  art.setAttribute('aria-label', 'Preview ' + mod.name);
  art.append(preview(mod, 'mod-card-top'));
  if (mod.new) art.append(node('span','new-label','RECENT ADDITION'));
  const body = node('div', 'card-body'), meta = node('div','card-meta');
  meta.append(node('span',null,mod.category.toUpperCase()),node('span',null,'v'+mod.version));
  body.append(meta,node('h3',null,mod.name),node('p',null,mod.description));
  const bottom = node('div','card-bottom'), installed = state.mods.some(m => m.id === mod.id);
  bottom.append(node('small',installed?'installed-tag':'',installed?'Installed':mod.repo.split('/')[0]),
    button('Details ↗','text-button',()=>detail(mod)));
  body.append(bottom);el.append(art,body);return el;
}
function renderCards() {
  const matches = state.catalog.filter(m => (category === 'All' || m.category === category) && [m.name,m.description,m.repo].join(' ').toLowerCase().includes(query));
  $('#catalog').replaceChildren(...matches.map(modCard));
  $('#result-count').textContent = matches.length + (matches.length === 1 ? ' mod' : ' mods');
  $('#search-empty').hidden = matches.length > 0;
  $('#featured').replaceChildren(...['MeasureTools','DeltaVMap','BasicHullCamera'].map(id=>modCard(state.catalog.find(m=>m.id===id))));
}
function detail(mod) {
  const el = $('#detail-content'); el.replaceChildren();
  const glyph=node('div','detail-glyph');glyph.innerHTML=icon(mod.glyph);
  el.append(glyph,node('p','eyebrow',mod.category.toUpperCase()+' / v'+mod.version),
    node('h2',null,mod.name),node('p','detail-description',mod.description));
  if (mod.preview) {
    const figure = node('figure', 'detail-preview');
    figure.append(preview(mod, 'detail-image', true), node('figcaption', null,
      mod.preview.kind + ' · ' + mod.repo.split('/')[0] + ' · May show an earlier mod version'));
    el.append(figure);
  }
  const info=node('div','detail-info');
  info.append(node('p',null,mod.compatibility), node('p',null,'Required: StarMap'+(mod.dependencies.length?', '+mod.dependencies.join(', '):'')),
    node('p',null,'License: '+mod.license+' · Source: '+mod.repo));
  el.append(info);
  const installed=state.mods.find(m=>m.id===mod.id), same=installed?.version===mod.version;
  const actions=node('div','detail-actions');
  const install=button(same?'Reinstall v'+mod.version:installed?'Install v'+mod.version:'Install mod','primary',()=>{
    $('#mod-detail').close();
    action(async()=>{toast('Preparing '+mod.name+'…');return window.ksa.install(mod.id)},mod.name+' installed. Review it in Your library.');
  });
  install.disabled=state.running||state.busy||working;
  actions.append(install,button('View on GitHub ↗','secondary',()=>action(()=>window.ksa.source(mod.id))));
  el.append(actions);
  $('#mod-detail').showModal();
}
function renderLibrary() {
  $('#installed').replaceChildren();
  $('#installed').hidden=!state.mods.length;
  $('#library-empty').hidden=!!state.mods.length;
  $('#library-summary').textContent=state.mods.length+' installed · '+state.enabled.length+' enabled';
  for(const mod of state.mods) {
    const entry=state.catalog.find(m=>m.id===mod.id);
    const row=node('div','installed-row'), mark=node('div','installed-icon');
    mark.innerHTML=icon(entry?.glyph||'grid');
    const copy=node('div','installed-copy');
    copy.append(node('h3',null,mod.name),node('small',null,mod.valid?(mod.version?'v'+mod.version+' · ':'')+(mod.enabled?'Enabled for next launch':'Installed, currently disabled'):'Missing or invalid mod.toml'));
    const label=node('label','switch-label',mod.enabled?'Enabled':'Disabled'), toggle=node('input','switch');
    toggle.type='checkbox';toggle.checked=mod.enabled;toggle.setAttribute('aria-label','Enable '+mod.name);
    toggle.disabled=!mod.valid||state.running||state.busy||working;
    toggle.onchange=()=>action(()=>window.ksa['set-mod'](mod.id,toggle.checked));
    label.append(toggle);
    row.append(mark,copy);
    if(entry)row.append(button('Details','text-button',()=>detail(entry)));
    row.append(label);$('#installed').append(row);
  }
}
function renderSettings() {
  $('#paths').replaceChildren();
  for(const [key,title,description] of [['install','Game installation','Folder containing the KSA executable.'],['starmap','StarMap loader','Required for code mods.'],['data','Game user folder','Contains your manifest, mods, and logs.']]) {
    const row=node('div','path-row'), copy=node('div');
    copy.append(node('h3',null,title),node('p',null,description),node('p',null,state.paths[key]));
    if(key==='starmap')copy.append(button('Get StarMap ↗','text-button',()=>action(()=>window.ksa.source('StarMap'))));
    row.append(copy,button('Choose folder','secondary',()=>action(()=>window.ksa['pick-path'](key))));
    $('#paths').append(row);
  }
}
$$('[data-page]').forEach(el=>el.onclick=()=>page(el.dataset.page));
$('.brand').onclick=event=>{event.preventDefault();page('home')};
$$('.refresh').forEach(el=>el.onclick=refresh);
$$('[data-open]').forEach(el=>el.onclick=()=>action(()=>window.ksa.open(el.dataset.open)));
$$('.backup').forEach(el=>el.onclick=()=>action(()=>window.ksa.backup(),'Backup saved. Open Backups from Settings to find it.'));
$$('.launch').forEach(el=>el.onclick=()=>action(()=>window.ksa.launch(),'Launch started.'));
$$('.close-game').forEach(el=>el.onclick=()=>action(()=>window.ksa.close()));
$('#reset').onclick=()=>action(()=>window.ksa['reset-mods']());
$('#save-gpu').onclick=()=>action(()=>window.ksa['set-gpu']($('#gpu').value),'Graphics profile saved.');
$('#detail-close').onclick=()=>$('#mod-detail').close();
$('#search').oninput=e=>{query=e.target.value.trim().toLowerCase();renderCards()};
$$('[data-category]').forEach(el=>el.onclick=()=>{
  category=el.dataset.category;$$('[data-category]').forEach(b=>b.classList.toggle('selected',b===el));renderCards();
});
document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)){e.preventDefault();page('discover');$('#search').focus()}});
window.addEventListener('focus',()=>{if(!working)refresh()});
refresh();
setInterval(()=>{if(!working&&!$('#mod-detail').open&&!['INPUT','SELECT'].includes(document.activeElement.tagName))refresh()},7000);
