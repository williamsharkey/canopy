// Regenerates the images the README uses.
//
//   node shots.cjs ../media
//
// Every shot waits for the full-resolution insolation pass, not the draft that
// lands first, so the planting and the ground tint are the settled answer.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { launchOpts } = require('./browser.cjs');

const out = path.resolve(process.argv[2] || '../media');

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch(launchOpts());
  const p = await b.newPage({ viewport: { width: 1400, height: 880 } });
  const errs = [];
  p.on('pageerror', e => errs.push('[pageerror] ' + e.message));
  await p.goto('file://' + path.resolve(__dirname, '../index.html'));
  await p.waitForFunction(() => window.__sun && !window.__sun.coarse, null, { timeout: 30000 });

  const settle = () => p.waitForFunction(() => window.__sun && !window.__sun.coarse,
    null, { timeout: 30000 }).then(() => p.waitForTimeout(450));

  const set = async fn => {
    const s0 = await p.evaluate(() => window.__sun.seq);
    await p.evaluate(fn);
    await p.waitForFunction(s => window.__sun.seq > s && !window.__sun.coarse, s0, { timeout: 30000 });
    await p.waitForTimeout(450);
  };
  const chrome = on => p.evaluate(on => {
    for (const id of ['ui', 'hud']) document.getElementById(id).style.display = on ? '' : 'none';
  }, on);
  const view = async v => { await p.evaluate(v => window.__api.view(v), v); await p.waitForTimeout(450); };
  const shot = async name => {
    await p.screenshot({ path: path.join(out, name + '.png') });
    console.log('wrote', name + '.png');
  };

  // 1. The tool, controls and all.
  await settle();
  await view('over');
  await shot('tool');

  // 2. The same block with the panel out of the way.
  await chrome(false);
  await shot('hero');

  // 3. Bare desert -> dappled canopy, same camera, coverage the only change.
  //    Standing under it, because that is the view the idea is about.
  await view('street');
  await set(() => {
    const el = document.getElementById('cfg-cov'); el.value = 0;
    el.dispatchEvent(new Event('input'));
  });
  await shot('before-bare');
  await set(() => {
    const el = document.getElementById('cfg-cov'); el.value = 50;
    el.dispatchEvent(new Event('input'));
  });
  await shot('after-canopy');

  // 4. The insolation map on its own. Canopy and modules hidden, so what is
  //    left is only the light that reached the dirt.
  await p.evaluate(() => {
    document.getElementById('cfg-sunmap').click();
    document.getElementById('cfg-plants').click();
    document.getElementById('cfg-growth').click();
    const el = document.getElementById('cfg-style'); el.value = 'none';
    el.dispatchEvent(new Event('change'));
    window.__api.modules.visible = false;
  });
  await settle();
  await view('top');
  await shot('sun-map');

  // 5. Somewhere else entirely: 40°N at midwinter noon, sun only 26° up.
  await p.evaluate(() => {
    for (const id of ['cfg-sunmap', 'cfg-plants', 'cfg-growth']) document.getElementById(id).click();
    const el = document.getElementById('cfg-style'); el.value = 'net';
    el.dispatchEvent(new Event('change'));
    window.__api.modules.visible = true;
    document.getElementById('site-4').click();
    const d = document.getElementById('cfg-day'); d.value = 355; d.dispatchEvent(new Event('input'));
    const h = document.getElementById('cfg-hour'); h.value = 13; h.dispatchEvent(new Event('input'));
  });
  await settle();
  await view('over');
  await shot('winter-kubuqi');

  console.log('errors:', errs.length ? '\n' + errs.join('\n') : '(none)');
  await b.close();
})();
