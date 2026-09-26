const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const AdmZip = require('adm-zip');
const { parse } = require('smol-toml');
const core = require('../src/core');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ksa-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, mods: path.join(dir, 'mods'), backups: path.join(dir, 'backups'), manifest: path.join(dir, 'manifest.toml') };
}
function archive(p, prefix = '') {
  const zip = new AdmZip();
  zip.addFile(prefix + 'mod.toml', Buffer.from('name="Demo"\nversion="1.0"\n'));
  zip.addFile(prefix + 'Demo.dll', Buffer.from('test-fixture'));
  const file = path.join(p.dir, 'demo.zip'); zip.writeZip(file); return file;
}
test('manifest toggles preserve unrelated TOML and never disable Core', t => {
  const p = fixture(t);
  fs.writeFileSync(p.manifest, 'title="User setting"\n[[mods]]\nid="Core"\nenabled=true\n[[mods]]\nid="Demo"\nenabled=false\ncustom="keep"\n');
  core.setMod(p.manifest, p.backups, 'Demo', true);
  assert.equal(core.modStates(p.manifest).Demo, true);
  assert.equal(parse(fs.readFileSync(p.manifest,'utf8')).mods[1].custom, 'keep');
  core.resetMods(p.manifest,p.backups);
  assert.deepEqual(core.modStates(p.manifest), { Core: true, Demo: false });
  assert.equal(parse(fs.readFileSync(p.manifest,'utf8')).title,'User setting');
  assert.throws(()=>core.setMod(p.manifest,p.backups,'Core',false));
  assert.ok(fs.readdirSync(p.backups).length >= 2);
});
for (const prefix of ['', 'Demo/', 'package/mods/Demo/']) {
  test('install handles archive prefix ' + JSON.stringify(prefix), t => {
    const p = fixture(t);
    core.installArchive(archive(p, prefix), { id:'Demo' }, p);
    assert.equal(fs.readFileSync(path.join(p.mods,'Demo','Demo.dll'),'utf8'),'test-fixture');
    assert.equal(core.modStates(p.manifest).Demo,false);
    assert.equal(core.modStates(p.manifest).Core,true);
  });
}
test('update preserves enabled state and saves old files', t => {
  const p=fixture(t), file=archive(p);
  core.installArchive(file,{id:'Demo'},p);
  core.setMod(p.manifest,p.backups,'Demo',true);
  fs.writeFileSync(path.join(p.mods,'Demo','user-settings.toml'),'old=true');
  core.installArchive(file,{id:'Demo'},p);
  assert.equal(core.modStates(p.manifest).Demo,true);
  assert.ok(fs.readdirSync(p.backups).some(x=>fs.existsSync(path.join(p.backups,x,'user-settings.toml'))));
});
test('failed manifest update restores original installed folder', t=>{
  const p=fixture(t), file=archive(p);
  fs.mkdirSync(path.join(p.mods,'Demo'),{recursive:true});
  fs.writeFileSync(path.join(p.mods,'Demo','original.txt'),'recoverable');
  fs.writeFileSync(p.manifest,'broken=[');
  assert.throws(()=>core.installArchive(file,{id:'Demo'},p));
  assert.equal(fs.readFileSync(path.join(p.mods,'Demo','original.txt'),'utf8'),'recoverable');
  assert.equal(fs.existsSync(path.join(p.mods,'Demo','Demo.dll')),false);
});
test('archive rejects traversal, Windows paths, links, duplicate and excessive files',()=>{
  const manifest = {entryName:'mod.toml',isDirectory:false,attr:0,header:{size:12},getData:()=>Buffer.from('name="Demo"')};
  for(const name of ['../bad','C:/bad','C:\\bad','/tmp/bad','Demo/CON.dll','Demo/foo.','Demo/../x']){
    assert.throws(()=>core.archivePlan({getEntries:()=>[manifest,{...manifest,entryName:name}]}),/unsafe/i);
  }
  assert.throws(()=>core.archivePlan({getEntries:()=>[manifest,{...manifest,entryName:'link',attr:0o120777<<16}]}),/unsafe/i);
  assert.throws(()=>core.archivePlan({getEntries:()=>[manifest,{...manifest,entryName:'MOD.TOML'}]}),/duplicate/i);
  assert.throws(()=>core.archivePlan({getEntries:()=>[{...manifest,header:{size:1024**3}}]}),/size/i);
});
test('dependencies and conflicts are enforced',()=>{
  const camera=core.catalog.find(m=>m.id==='BasicHullCamera');
  assert.throws(()=>core.dependenciesReady(camera,{ModMenu:true}),/CatsGotYourCam/);
  assert.doesNotThrow(()=>core.dependenciesReady(camera,{ModMenu:true,CatsGotYourCam:true}));
  assert.throws(()=>core.dependenciesReady(core.catalog.find(m=>m.id==='PoweredGuidance'),{AdvancedFlightComputer:true}),/overlapping/);
});
test('catalog has unique IDs and authors GitHub release URLs',()=>{
  assert.equal(core.catalog.length,new Set(core.catalog.map(m=>m.id)).size);
  for(const m of core.catalog) {
    assert.match(m.id,/^[A-Za-z0-9_-]+$/);
    assert.ok(core.releaseURL(m).startsWith('https://github.com/'+m.repo+'/releases/download/'));
    for(const dep of m.dependencies)assert.ok(core.catalog.find(m=>m.id===dep));
  }
});

