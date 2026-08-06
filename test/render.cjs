const { chromium } = require('playwright');
const path = require('path');
const { launchOpts } = require('./browser.cjs');
const file = process.argv[2] || '../index.html';
const prefix = process.argv[3] || 'v1';
(async () => {
  const b = await chromium.launch(launchOpts());
  const p = await b.newPage({viewport:{width:1400,height:880}});
  const errs=[];
  p.on('pageerror',e=>errs.push('[pageerror] '+e.message));
  p.on('console',m=>{ if(m.type()==='error') errs.push('[console] '+m.text()); });
  await p.goto('file://'+path.resolve(__dirname, file));
  try { await p.waitForFunction(()=>window.__diag, null, {timeout:20000}); }
  catch(e){ console.log('TIMEOUT waiting for __diag'); console.log(errs.join('\n')); await p.screenshot({path:prefix+'-fail.png'}); await b.close(); process.exit(1); }
  await p.waitForTimeout(600);
  console.log('DIAG', JSON.stringify(await p.evaluate(()=>window.__diag)));
  console.log('STATS', await p.evaluate(()=>document.getElementById('stats').innerText.replace(/\n/g,' | ')));
  for (const v of ['over','top','street']) {
    await p.evaluate(v=>window.__api.view(v), v);
    await p.waitForTimeout(500);
    await p.screenshot({path:`${prefix}-${v}.png`});
  }
  console.log('ERRORS:', errs.length? '\n'+errs.join('\n') : '(none)');
  await b.close();
})();
