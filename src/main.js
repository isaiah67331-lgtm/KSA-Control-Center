const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const AdmZip = require('adm-zip');
const core = require('./core');
const exec = promisify(execFile);
app.disableHardwareAcceleration();
const winOS = process.platform === 'win32';
const testHome = process.env.KSA_TEST_HOME;
const home = testHome || os.homedir();
const appData = winOS ? path.join(process.env.APPDATA || home, 'KSA Companion') : path.join(home, '.local/share/ksa-companion');
const configFile = path.join(winOS ? appData : path.join(home, '.config/ksa-companion'), 'config.json');
const config = () => core.readJSON(configFile);
const saveConfig = data => core.atomic(configFile, JSON.stringify(data, null, 2) + '\n');
let window, busy = false, child;

function paths() {
  const cfg = config();
  const documents = testHome ? path.join(home, 'Documents') : app.getPath('documents');
  const data = cfg.data_dir || path.join(documents, 'My Games/Kitten Space Agency');
  const install = cfg.game_install || (winOS ? path.join(process.env.ProgramFiles || 'C:/Program Files', 'Kitten Space Agency') : path.join(home, '.local/share/KittenSpaceAgency'));
  const starmap = cfg.starmap_dir || path.join(appData, 'StarMap');
  return { data, install, starmap, executable: path.join(install, winOS ? 'KSA.exe' : 'KSA'),
    runner: path.join(starmap, winOS ? 'StarMap.exe' : 'StarMap.dll'),
    mods: path.join(data, 'mods'), manifest: path.join(data, 'manifest.toml'),
    backups: path.join(data, 'companion-backups'), logs: path.join(data, 'Logs') };
}
async function processes() {
  if (testHome) return [];
  const p = paths(), matches = [];
  if (winOS) {
    const result = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | Where-Object { $_.Name -in @("KSA.exe","StarMap.exe","dotnet.exe") } | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress'], { windowsHide: true, timeout: 10000 });
    const entries = JSON.parse(result.stdout.trim() || '[]');
    for (const e of Array.isArray(entries) ? entries : [entries]) {
      const file = (e.ExecutablePath || '').toLowerCase();
      if ([p.executable, p.runner].some(x => x.toLowerCase() === file) ||
          (file.endsWith('dotnet.exe') && (e.CommandLine || '').includes(path.join(p.starmap, 'StarMap.dll')))) matches.push(e.ProcessId);
    }
  } else {
    for (const item of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(item)) continue;
      try {
        const args = fs.readFileSync('/proc/' + item + '/cmdline', 'utf8').split('\0').filter(Boolean);
        const cwd = fs.readlinkSync('/proc/' + item + '/cwd');
        const file = args[0] && path.resolve(cwd, args[0]);
        if (file === p.executable || (path.basename(args[0] || '') === 'dotnet' && args[1] && path.resolve(cwd, args[1]) === path.join(p.starmap, 'StarMap.dll'))) matches.push(Number(item));
      } catch { /* Process exited or belongs to another user. */ }
    }
  }
  if (child && child.exitCode === null && child.signalCode === null && child.pid && !matches.includes(child.pid)) matches.push(child.pid);
  return matches;
}
function detectedGPU() {
  if (winOS) return 'System default';
  try {
    const cards = fs.readdirSync('/sys/class/drm').filter(name => /^card\d+$/.test(name));
    const devices = cards.map(card => fs.readFileSync('/sys/class/drm/' + card + '/device/vendor', 'utf8').trim());
    if (devices.includes('0x8086')) return 'Intel Arc';
    if (devices.includes('0x10de')) return 'NVIDIA';
    if (devices.includes('0x1002')) return 'AMD Radeon';
  } catch {}
  return 'System default';
}
async function state() {
  const p = paths(), cfg = config(), mods = core.listMods(p.mods, p.manifest);
  const states = core.modStates(p.manifest), enabled = Object.keys(states).filter(id => id !== 'Core' && states[id]);
  const running = (await processes()).length > 0;
  let problem = '';
  if (!fs.existsSync(p.executable)) problem = 'Choose your KSA installation in Settings.';
  else if (enabled.length && !fs.existsSync(p.runner)) problem = 'Choose your StarMap folder in Settings to launch with mods.';
  else if (enabled.some(id => !mods.some(m => m.id === id && m.valid))) problem = 'An enabled mod is missing or invalid. Review your Library.';
  const gpu = cfg.gpu_choice || 'Auto-detect';
  return { running, busy, ready: !problem && !running && !busy, problem, enabled, mods, catalog: core.catalog,
    paths: p, gpu, effectiveGPU: gpu === 'Auto-detect' ? detectedGPU() : gpu, platform: winOS ? 'Windows' : 'Linux', version: app.getVersion() };
}
async function idle() {
  if (busy) throw new Error('Wait for the current operation to finish.');
  if ((await processes()).length) throw new Error('Close KSA before changing mods or settings.');
}
function handle(name, fn) {
  ipcMain.handle(name, async (event, ...args) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Invalid app window.');
    return fn(...args);
  });
}
handle('state', state);
handle('set-mod', async (id, enabled) => {
  await idle(); const p = paths();
  if (!core.listMods(p.mods, p.manifest).some(m => m.id === id && m.valid)) throw new Error('Mod is missing or invalid.');
  if (enabled) {
    const entry = core.catalog.find(m => m.id === id);
    if (entry) core.dependenciesReady(entry, core.modStates(p.manifest));
  } else {
    const states = core.modStates(p.manifest);
    const dependents = core.catalog.filter(m => states[m.id] && m.dependencies.includes(id));
    if (dependents.length) throw new Error('Disable these dependent mods first: ' + dependents.map(m => m.name).join(', '));
  }
  core.setMod(p.manifest, p.backups, id, enabled);
});
handle('reset-mods', async () => {
  await idle();
  const answer = await dialog.showMessageBox(window, { type: 'question', message: 'Disable all community mods?',
    detail: 'Mod files stay installed. Your current list is backed up and Core stays enabled.', buttons: ['Cancel', 'Disable mods'], defaultId: 0, cancelId: 0 });
  if (answer.response === 1) { const p = paths(); core.resetMods(p.manifest, p.backups); }
});
handle('pick-path', async kind => {
  if (!['install', 'data', 'starmap'].includes(kind)) throw new Error('Unknown folder type.');
  const picked = await dialog.showOpenDialog(window, { title: 'Choose ' + kind + ' folder', properties: ['openDirectory'] });
  if (picked.canceled) return;
  await idle();
  const folder = picked.filePaths[0], key = { install: 'game_install', data: 'data_dir', starmap: 'starmap_dir' }[kind];
  if (kind === 'install' && !fs.existsSync(path.join(folder, winOS ? 'KSA.exe' : 'KSA'))) throw new Error('This folder does not contain the KSA executable.');
  if (kind === 'starmap' && !fs.existsSync(path.join(folder, winOS ? 'StarMap.exe' : 'StarMap.dll'))) throw new Error('This folder does not contain the StarMap launcher.');
  if (kind === 'data' && !fs.existsSync(path.join(folder, 'manifest.toml'))) throw new Error('Choose the KSA user folder containing manifest.toml.');
  saveConfig({ ...config(), [key]: folder });
});
handle('set-gpu', async gpu => {
  await idle();
  if (!core.GPU_CHOICES.includes(gpu)) throw new Error('Unknown GPU profile.');
  saveConfig({ ...config(), gpu_choice: gpu });
});
handle('open', async target => {
  if (!['mods', 'logs', 'backups'].includes(target)) throw new Error('Unknown folder.');
  const folder = paths()[target];
  fs.mkdirSync(folder, { recursive: true });
  const error = await shell.openPath(folder);
  if (error) throw new Error(error);
});
handle('source', async id => {
  const mod = core.catalog.find(m => m.id === id);
  const url = id === 'StarMap' ? 'https://github.com/StarMapLoader/StarMap/releases' : mod && 'https://github.com/' + mod.repo;
  if (!url) throw new Error('Unknown project.');
  await shell.openExternal(url);
});
handle('backup', async () => {
  await idle(); const p = paths();
  fs.mkdirSync(p.backups, { recursive: true });
  const zip = new AdmZip();
  if (fs.existsSync(p.mods)) zip.addLocalFolder(p.mods, 'mods');
  if (fs.existsSync(p.manifest)) zip.addLocalFile(p.manifest);
  zip.writeZip(path.join(p.backups, 'mods-' + Date.now() + '.zip'));
});
handle('close', async () => {
  const ids = await processes();
  if (!ids.length) return;
  const answer = await dialog.showMessageBox(window, { type: 'question', message: 'Close KSA?', detail: 'Unsaved progress may be lost.', buttons: ['Cancel', 'Close KSA'], defaultId: 0, cancelId: 0 });
  if (answer.response !== 1) return;
  for (const pid of ids) { try { process.kill(pid, 'SIGTERM'); } catch {} }
});
handle('launch', async () => {
  const s = await state(); if (!s.ready) throw new Error(s.problem || 'KSA is already running or an operation is in progress.');
  const p = paths(), modded = s.enabled.length > 0;
  const states = core.modStates(p.manifest);
  for (const m of core.catalog.filter(m => states[m.id])) core.dependenciesReady(m, states);
  if (modded) {
    const file = path.join(p.starmap, 'StarMapConfig.json'), data = core.readJSON(file);
    if (data.GameLocation !== p.install) {
      core.backupFile(file, p.backups);
      core.atomic(file, JSON.stringify({ RepositoryLocation: '', GameArguments: [], ...data, GameLocation: p.install }, null, 2));
    }
  }
  const env = { ...process.env };
  const icd = '/usr/share/vulkan/icd.d/intel_icd.x86_64.json';
  if (!winOS && s.effectiveGPU === 'Intel Arc' && fs.existsSync(icd)) { env.VK_DRIVER_FILES = icd; env.MESA_VK_WSI_PRESENT_MODE = 'fifo'; }
  fs.mkdirSync(p.logs, { recursive: true });
  const out = fs.openSync(path.join(p.logs, 'arc-launcher.log'), 'a');
  try {
    await new Promise((resolve, reject) => {
      child = spawn(modded ? (winOS ? p.runner : 'dotnet') : p.executable, modded && !winOS ? [p.runner] : [],
        { cwd: modded ? p.starmap : p.install, env, detached: true, stdio: ['ignore', out, out], windowsHide: false });
      child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); });
    });
  } finally { fs.closeSync(out); }
});
handle('install', async id => {
  await idle(); const mod = core.catalog.find(m => m.id === id);
  if (!mod) throw new Error('Unknown catalog mod.');
  const p = paths();
  const result = await dialog.showMessageBox(window, { type: 'question', message: 'Install ' + mod.name + '?',
    detail: 'From github.com/' + mod.repo + '\n\n' + mod.compatibility + '\n\nNew mods are installed disabled. Enable them in Library when ready.',
    buttons: ['Cancel', 'Install'], defaultId: 0, cancelId: 0 });
  if (result.response !== 1) return false;
  await idle(); busy = true;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ksa-download-'));
  try {
    const archive = path.join(temp, 'release.zip');
    await core.download(core.releaseURL(mod), archive);
    if ((await processes()).length) throw new Error('KSA was started during the download. Close it and try again.');
    core.installArchive(archive, mod, p);
    return true;
  } finally { busy = false; fs.rmSync(temp, { recursive: true, force: true }); }
});

app.whenReady().then(() => {
  window = new BrowserWindow({ width: 1280, height: 850, minWidth: 960, minHeight: 650, backgroundColor: '#171716',
    title: 'KSA Control Center', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  window.loadFile(path.join(__dirname, 'index.html'));
});
app.on('window-all-closed', () => app.quit());
