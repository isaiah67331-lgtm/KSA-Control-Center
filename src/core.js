const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parse, stringify } = require('smol-toml');
const AdmZip = require('adm-zip');
const catalog = require('./catalog.json');

const MAX_DOWNLOAD = 256 * 1024 * 1024;
const MAX_EXPANDED = 512 * 1024 * 1024;
const GPU_CHOICES = ['Auto-detect', 'Intel Arc', 'AMD Radeon', 'NVIDIA', 'System default'];
const exists = file => fs.existsSync(file);
function atomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  try { fs.writeFileSync(temp, data); fs.renameSync(temp, file); }
  finally { fs.rmSync(temp, { force: true }); }
}
function readJSON(file, fallback = {}) {
  if (!exists(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function readManifest(file) {
  const data = exists(file) ? parse(fs.readFileSync(file, 'utf8')) : { mods: [{ id: 'Core', enabled: true }] };
  if (data.mods && !Array.isArray(data.mods)) throw new Error('The mod manifest has an invalid mods section.');
  data.mods ||= [];
  return data;
}
function modStates(file) {
  return Object.fromEntries(readManifest(file).mods.map(mod => [mod.id, mod.enabled === true]));
}
function backupFile(file, backupDir) {
  if (!exists(file)) return;
  fs.mkdirSync(backupDir, { recursive: true });
  fs.copyFileSync(file, path.join(backupDir, path.basename(file) + '-' + Date.now() + '-' + crypto.randomUUID()));
}
function setMod(file, backupDir, id, enabled) {
  if (!/^[A-Za-z0-9_. -]+$/.test(id) || id === 'Core' || typeof enabled !== 'boolean') throw new Error('Invalid mod selection.');
  const data = readManifest(file);
  const entry = data.mods.find(m => m.id === id);
  if (entry) entry.enabled = enabled;
  else data.mods.push({ id, enabled });
  backupFile(file, backupDir);
  atomic(file, stringify(data));
}
function resetMods(file, backupDir) {
  const data = readManifest(file);
  for (const mod of data.mods) mod.enabled = mod.id === 'Core';
  if (!data.mods.some(m => m.id === 'Core')) data.mods.unshift({ id: 'Core', enabled: true });
  backupFile(file, backupDir);
  atomic(file, stringify(data));
}
function listMods(folder, manifest) {
  const states = modStates(manifest);
  if (!exists(folder)) return [];
  return fs.readdirSync(folder, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => {
    const file = path.join(folder, e.name, 'mod.toml');
    let info = {}, valid = true, installed = {};
    try { installed = readJSON(path.join(folder, e.name, '.control-center.json')); } catch {}
    try { info = parse(fs.readFileSync(file, 'utf8')); } catch { valid = false; }
    return { id: e.name, name: info.name || e.name, version: String(info.version || installed.version || ''), valid, enabled: states[e.name] === true };
  }).sort((a, b) => a.name.localeCompare(b.name));
}
function dependenciesReady(mod, states) {
  const missing = (mod.dependencies || []).filter(id => !states[id]);
  if (missing.length) throw new Error('Enable these required mods first: ' + missing.join(', ') + '.');
  const conflicts = (mod.conflicts || []).filter(id => states[id]);
  if (conflicts.length) throw new Error('Disable the overlapping mod first: ' + conflicts.join(', ') + '.');
}

// Validate the complete archive before making any changes to the installed mod.
function archivePlan(zip) {
  const entries = zip.getEntries();
  if (!entries.length || entries.length > 20000) throw new Error('Archive has an invalid number of files.');
  const names = new Set();
  let bytes = 0;
  for (const entry of entries) {
    const name = entry.entryName;
    const segments = name.split('/');
    const mode = (entry.attr >>> 16) & 0o170000;
    if (name.startsWith('/') || name.includes('\\') || /[:\x00-\x1f]/.test(name) ||
        segments.some(s => s === '..' || s === '.' || /[. ]$/.test(s) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(s)) ||
        mode === 0o120000) throw new Error('Archive contains an unsafe path or symbolic link.');
    const key = name.replace(/\/$/, '').toLowerCase();
    if (names.has(key)) throw new Error('Archive has duplicate file paths.');
    names.add(key);
    bytes += entry.header.size;
    if (entry.header.size > MAX_DOWNLOAD || bytes > MAX_EXPANDED) throw new Error('Archive exceeds the extraction size limit.');
  }
  const manifests = entries.filter(e => !e.isDirectory && /(^|\/)mod\.toml$/.test(e.entryName));
  if (manifests.length !== 1) throw new Error('Expected exactly one mod.toml in this release.');
  const prefix = manifests[0].entryName.slice(0, -'mod.toml'.length);
  parse(manifests[0].getData().toString('utf8'));
  return entries.filter(e => !e.isDirectory && e.entryName.startsWith(prefix)).map(e => ({ entry: e, relative: e.entryName.slice(prefix.length) }));
}
function installArchive(archive, mod, paths) {
  const zip = new AdmZip(archive);
  const plan = archivePlan(zip);
  fs.mkdirSync(paths.mods, { recursive: true });
  if (fs.lstatSync(paths.mods).isSymbolicLink()) throw new Error('The mods folder must not be a symbolic link.');
  const stage = fs.mkdtempSync(path.join(paths.mods, '.install-'));
  const destination = path.join(paths.mods, mod.id);
  let backup, published = false;
  try {
    for (const { entry, relative } of plan) {
      const target = path.join(stage, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, entry.getData(), { flag: 'wx' });
    }
    fs.writeFileSync(path.join(stage, '.control-center.json'), JSON.stringify({ version: mod.version || '', repo: mod.repo || '', installedAt: new Date().toISOString() }, null, 2));
    if (exists(destination)) {
      if (fs.lstatSync(destination).isSymbolicLink()) throw new Error('The existing mod must not be a symbolic link.');
      fs.mkdirSync(paths.backups, { recursive: true });
      backup = path.join(paths.backups, mod.id + '-' + Date.now() + '-' + crypto.randomUUID());
      fs.renameSync(destination, backup);
    }
    fs.renameSync(stage, destination);
    published = true;
    // New mods start disabled. Updates retain their existing enabled state.
    const enabled = modStates(paths.manifest)[mod.id] === true;
    setMod(paths.manifest, paths.backups, mod.id, enabled);
  } catch (error) {
    if (published) fs.rmSync(destination, { recursive: true, force: true });
    if (backup) fs.renameSync(backup, destination);
    throw error;
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}
async function download(url, file) {
  let current = url;
  const allowed = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
  for (let redirects = 0; redirects < 6; redirects++) {
    const parsed = new URL(current);
    if (parsed.protocol !== 'https:' || !allowed.has(parsed.hostname)) throw new Error('Unexpected release download destination.');
    const response = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(120000), headers: { 'User-Agent': 'KSA-Control-Center' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      current = new URL(response.headers.get('location'), current).href;
      await response.body?.cancel();
      continue;
    }
    if (!response.ok) throw new Error('Release download failed (HTTP ' + response.status + ').');
    const fd = fs.openSync(file, 'wx');
    let bytes = 0;
    try {
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > MAX_DOWNLOAD) throw new Error('Download exceeds the 256 MiB limit.');
        fs.writeSync(fd, chunk);
      }
    } finally { fs.closeSync(fd); }
    return;
  }
  throw new Error('Too many redirects from the release server.');
}
function releaseURL(mod) { return 'https://github.com/' + mod.repo + '/releases/download/' + mod.tag + '/' + mod.asset; }
module.exports = { catalog, GPU_CHOICES, atomic, readJSON, modStates, setMod, resetMods, listMods, dependenciesReady, archivePlan, installArchive, download, releaseURL, backupFile };
