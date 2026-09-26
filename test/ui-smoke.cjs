// Runs the real Electron UI against an isolated fake home. Never touches game data.
const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
(async()=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ksa-ui-'));
  let app;
  try {
    const game=path.join(temporary,'.local/share/KittenSpaceAgency');
    fs.mkdirSync(game,{recursive:true});fs.writeFileSync(path.join(game,process.platform==='win32'?'KSA.exe':'KSA'),'fixture');
    const user=path.join(temporary,'Documents/My Games/Kitten Space Agency');
    fs.mkdirSync(path.join(user,'mods/ModMenu'),{recursive:true});
    fs.writeFileSync(path.join(user,'mods/ModMenu/mod.toml'),'name="ModMenu"\nversion="0.2.2"');
    fs.writeFileSync(path.join(user,'manifest.toml'),'[[mods]]\nid="Core"\nenabled=true\n[[mods]]\nid="ModMenu"\nenabled=false');
    app=await electron.launch({args:[path.resolve(__dirname,'..')],env:{...process.env,KSA_TEST_HOME:temporary}});
    const page=await app.firstWindow(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.getByText('Ready to launch',{exact:true}).waitFor();
    fs.mkdirSync(path.join(__dirname,'../test-results'),{recursive:true});
    for (const img of await page.locator('#featured .mod-preview').all()) {
      await img.scrollIntoViewIfNeeded();
      await img.evaluate(img => img.decode());
    }
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:path.join(__dirname,'../test-results/overview.png'),fullPage:true});
    await page.getByRole('button',{name:'Discover mods'}).click();
    await page.locator('#catalog .mod-card').last().waitFor();
    assert.equal(await page.locator('#catalog .mod-card').count(),9);
    assert.equal(await page.locator('#catalog .mod-preview').count(),6);
    // Scroll each lazy-loaded preview into view and verify real image decoding.
    for (const img of await page.locator('#catalog .mod-preview').all()) {
      await img.scrollIntoViewIfNeeded();
      await img.evaluate(img => img.decode());
      assert.ok(await img.evaluate(img => img.naturalWidth > 0));
    }
    await page.getByRole('searchbox').fill('camera');
    assert.equal(await page.locator('#catalog .mod-card').count(),2);
    await page.getByRole('searchbox').fill('not-a-mod');
    assert.equal(await page.locator('#search-empty').isVisible(),true);
    await page.getByRole('searchbox').fill('');
    await page.locator('#filters').getByRole('button',{name:'Parts',exact:true}).click();
    assert.equal(await page.locator('#catalog .mod-card').count(),2);
    await page.getByRole('button',{name:'All mods',exact:true}).click();
    await page.locator('#catalog .mod-card').filter({has:page.getByRole('heading',{name:'Basic Hull Camera',exact:true})}).getByRole('button',{name:'Details'}).click();
    await page.locator('#mod-detail').waitFor();
    assert.match(await page.locator('#detail-content').innerText(),/CatsGotYourCam/);
    await page.locator('#detail-content img').evaluate(img => img.decode());
    await page.screenshot({path:path.join(__dirname,'../test-results/mod-preview.png')});
    await page.getByRole('button',{name:'Close mod details'}).click();
    const brokenPreview=page.locator('#catalog .mod-preview').first();
    await brokenPreview.evaluate(img=>img.dispatchEvent(new Event('error')));
    assert.equal(await page.locator('#catalog .mod-preview').count(),5);
    await page.getByRole('button',{name:'All mods',exact:true}).click();
    await page.evaluate(()=>window.scrollTo(0,0));
    for (const img of await page.locator('#catalog .mod-preview').all()) {
      await img.scrollIntoViewIfNeeded();
      await img.evaluate(img => img.decode());
    }
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:path.join(__dirname,'../test-results/discover.png'),fullPage:true});
    await page.getByRole('button',{name:/Your library/}).click();
    await page.getByRole('checkbox',{name:'Enable ModMenu'}).check();
    await page.getByText('1 installed · 1 enabled',{exact:true}).waitFor();
    assert.match(fs.readFileSync(path.join(user,'manifest.toml'),'utf8'),/enabled = true/);
    await page.getByRole('button',{name:'Back up mods',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Backup saved'}).waitFor();
    assert.ok(fs.readdirSync(path.join(user,'companion-backups')).some(x=>x.endsWith('.zip')));
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.locator('#gpu').selectOption('System default');
    await page.getByRole('button',{name:'Save profile'}).click();
    await page.getByRole('status').filter({hasText:'Graphics profile saved'}).waitFor();
    await page.setViewportSize({width:960,height:650});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
    assert.deepEqual(errors,[]);
    console.log('Electron UI passed: overview, nine cards, six decoded previews, missing-image fallback, search, filters, detail image, toggle, backup, settings, minimum-width layout.');
  } finally {
    if(app)await app.close();
    fs.rmSync(temporary,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1});
