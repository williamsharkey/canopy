// Functional pass over the UI: exercises every control and the awkward inputs.
const { chromium } = require('playwright');
const path = require('path');
const { launchOpts } = require('./browser.cjs');

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  (ok ? pass++ : fail++);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`);
};

(async () => {
  const b = await chromium.launch(launchOpts());
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  p.on('pageerror', e => errs.push('[pageerror] ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text())) errs.push('[console] ' + m.text()); });

  await p.goto('file://' + path.resolve(__dirname, '../index.html'));
  await p.waitForFunction(() => window.__diag, null, { timeout: 20000 });

  const diag = () => p.evaluate(() => window.__diag);
  const surf = () => p.evaluate(() => {
    const s = window.__api.surface;
    let mn = Infinity, mx = -Infinity, nan = 0, act = 0;
    for (let k = 0; k < s.y.length; k++) {
      if (!s.active[k]) continue;
      act++;
      if (!isFinite(s.y[k])) nan++;
      if (s.y[k] < mn) mn = s.y[k];
      if (s.y[k] > mx) mx = s.y[k];
    }
    return { min: +mn.toFixed(2), max: +mx.toFixed(2), nan, act };
  });
  const settle = ms => p.waitForTimeout(ms === undefined ? 350 : ms);
  const msgText = () => p.evaluate(() => document.getElementById('msg').textContent);

  // Background pages throttle setTimeout, so never sleep and hope: run the
  // action, then wait for the rebuild counter to actually advance.
  const act = async fn => {
    const s0 = await p.evaluate(() => window.__diag.seq);
    await fn();
    await p.waitForFunction(s => window.__diag.seq > s, s0, { timeout: 15000 });
    await p.waitForTimeout(60);
  };
  const click = id => act(() => p.evaluate(i => document.getElementById(i).click(), id));
  const setField = (id, v) => act(() => p.evaluate(([i, v]) => {
    const e = document.getElementById(i); e.value = v; e.dispatchEvent(new Event('change'));
  }, [id, v]));

  // -- 1. default state ------------------------------------------------------
  let s = await surf();
  check('default surface has no NaN', s.nan === 0, s);
  check('default surface stays above grade', s.min > 0, s);
  check('default peak matches the control node (46 ft)', Math.abs(s.max - 46) < 0.01, s);

  // -- 2. geometry is right-side up -----------------------------------------
  const up = await p.evaluate(() => {
    // Face normals of the membrane must point up, or the canopy renders unlit.
    const mesh = window.__api.surface;
    const g = document.querySelector('canvas') && null;
    let bad = 0, total = 0;
    const scene = window.__api;
    return (function () {
      const obj = [];
      // reach into the scene via the canopy group held on the surface build
      const m = window.__membrane;
      if (!m) return { skipped: true };
      const pos = m.geometry.attributes.position, ix = m.geometry.index.array;
      const v = k => [pos.getX(ix[k]), pos.getY(ix[k]), pos.getZ(ix[k])];
      for (let t = 0; t < ix.length; t += 3) {
        const a = v(t), c = v(t + 1), d = v(t + 2);
        const ab = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const ac = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
        const ny = ab[2] * ac[0] - ab[0] * ac[2];
        total++; if (ny < 0) bad++;
      }
      return { bad, total };
    })();
  });
  check('all membrane faces wind upward', up.skipped || up.bad === 0, up);

  // -- 3. adding / editing / deleting nodes ---------------------------------
  await act(() => p.evaluate(() => {
    document.getElementById('inp-dx').value = '10';
    document.getElementById('inp-dy').value = '26';
    document.getElementById('inp-dz').value = '10';
    document.getElementById('btn-add').click();
  }));
  check('adding a node grows the control set', (await diag()).ctrl > 52, await diag());
  s = await surf();
  check('added valley pulls the surface down', s.min < 30, s);

  await act(() => p.evaluate(() => {
    const inp = document.querySelectorAll('#point-body tr')[1].querySelectorAll('input')[1];
    inp.value = '60'; inp.dispatchEvent(new Event('change'));
  }));
  s = await surf();
  check('editing dy in the table raises the peak to 60', Math.abs(s.max - 60) < 0.01, s);

  const rowsBefore = await p.evaluate(() => document.querySelectorAll('#point-body tr').length);
  await act(() => p.evaluate(() => document.querySelectorAll('#point-body .del-btn')[1].click()));
  const rowsAfter = await p.evaluate(() => document.querySelectorAll('#point-body tr').length);
  check('delete removes exactly one row', rowsBefore === 2 && rowsAfter === 1, { rowsBefore, rowsAfter });

  // -- 4. bad input ----------------------------------------------------------
  const before = await diag();
  await p.evaluate(() => {
    document.getElementById('inp-dx').value = '';
    document.getElementById('btn-add').click();
  });
  await settle();
  check('empty dx is rejected, not turned into NaN geometry', (await diag()).ctrl === before.ctrl, await diag());
  check('empty dx explains itself', /number/i.test(await msgText()), await msgText());
  check('empty dx marks the field', await p.evaluate(() => document.getElementById('inp-dx').classList.contains('invalid')));

  await p.evaluate(() => {
    document.getElementById('inp-dx').value = '24';
    document.getElementById('inp-dy').value = '-5';
    document.getElementById('btn-add').click();
  });
  await settle();
  check('negative height is rejected', /cannot be negative/i.test(await msgText()), await msgText());

  await p.evaluate(() => {
    document.getElementById('inp-dx').value = '24';
    document.getElementById('inp-dy').value = '46';
    document.getElementById('inp-dz').value = '24';
    document.getElementById('btn-add').click();          // duplicate of the default node
  });
  await settle();
  check('duplicate dx/dz is rejected', /already sits/i.test(await msgText()), await msgText());

  await p.evaluate(() => {
    const r = document.querySelectorAll('#point-body tr')[0].querySelectorAll('input')[1];
    r.value = 'abc'; r.dispatchEvent(new Event('change'));
  });
  await settle();
  s = await surf();
  check('non-numeric table edit leaves the surface intact', s.nan === 0 && isFinite(s.max), s);

  // -- 5. empty design -------------------------------------------------------
  await click('btn-clear');
  s = await surf();
  check('clearing every node still builds (flat canopy at anchor height)',
    s.nan === 0 && Math.abs(s.max - 30) < 2, s);

  // -- 6. presets ------------------------------------------------------------
  await click('btn-preset-saddle');
  s = await surf();
  check('saddle preset produces both a peak and a valley', s.max > 40 && s.min < 28, s);
  await click('btn-preset-peak');
  check('peak preset builds', (await surf()).nan === 0);

  // -- 7. sliders ------------------------------------------------------------
  const setRange = (id, v) => act(() => p.evaluate(([id, v]) => {
    const el = document.getElementById(id); el.value = v;
    el.dispatchEvent(new Event('input'));
  }, [id, v]));

  await setRange('cfg-cov', 0);
  check('0% coverage places no modules', (await diag()).panels === 0, await diag());
  await setRange('cfg-cov', 100);
  const full = await diag();
  check('100% coverage fills the canopy', full.panels > 400, full);
  await setRange('cfg-cov', 50);

  // Compare only the free nodes: the minimum over the whole surface is a pinned
  // anchor, which sag cannot move.
  const freeMean = () => p.evaluate(() => {
    const s = window.__api.surface;
    let sum = 0, n = 0, mn = Infinity;
    for (let k = 0; k < s.y.length; k++) {
      if (!s.active[k] || s.pinned[k]) continue;
      sum += s.y[k]; n++; if (s.y[k] < mn) mn = s.y[k];
    }
    return { mean: +(sum / n).toFixed(2), min: +mn.toFixed(2) };
  });
  await setRange('cfg-sag', 0);
  const minimal = await freeMean();
  await setRange('cfg-sag', 12);
  const heavy = await freeMean();
  check('more sag lowers the surface', heavy.mean < minimal.mean - 1, { minimal, heavy });
  check('even max sag stays above grade', heavy.min > 0, heavy);
  await setRange('cfg-sag', 2);

  await setRange('cfg-relax', 0);
  check('zero relaxation still yields a surface (faceted Delaunay)', (await surf()).nan === 0, await surf());
  await setRange('cfg-relax', 300);

  await setRange('cfg-head', 0);
  check('zero mast head still builds', (await surf()).nan === 0);
  await setRange('cfg-head', 8);

  await setRange('cfg-panel', 4);
  const small = await diag();
  await setRange('cfg-panel', 16);
  const big = await diag();
  check('smaller modules means more of them', small.panels > big.panels, { small: small.panels, big: big.panels });
  await setRange('cfg-panel', 8);

  // The hour slider only moves the light, so it does not bump the build counter.
  const setHour = h => p.evaluate(h => {
    const el = document.getElementById('cfg-hour'); el.value = h;
    el.dispatchEvent(new Event('input'));
  }, h);
  await setHour(6);
  const dawn = await p.evaluate(() => [window.__sunY(), document.getElementById('lbl-hour').textContent]);
  await setHour(12.5);
  const noon = await p.evaluate(() => [window.__sunY(), document.getElementById('lbl-hour').textContent]);
  check('the sun climbs from dawn to midday', noon[0] > dawn[0], { dawn, noon });
  check('the hour label formats minutes', dawn[1] === '6:00' && noon[1] === '12:30', [dawn[1], noon[1]]);
  await setHour(13);

  // -- 7b. day cycle ---------------------------------------------------------
  const cycle = on => p.evaluate(on => {
    const el = document.getElementById('cfg-daycycle');
    if (el.checked !== on) el.click();
  }, on);

  await setHour(9);
  await cycle(true);
  // Sample consecutive frames: the hour has to creep, not jump. dt is clamped to
  // 0.1 s a frame, so no step can exceed 0.1/15 h however slow the render is.
  const run = await p.evaluate(() => new Promise(res => {
    const seen = [];
    (function tick() {
      seen.push([window.__api.CFG.hour,
                 document.getElementById('lbl-hour').textContent,
                 +document.getElementById('cfg-hour').value]);
      if (seen.length < 20) requestAnimationFrame(tick); else res(seen);
    })();
  }));
  const steps = run.slice(1).map((s, i) => s[0] - run[i][0]);
  check('the day cycle advances the hour smoothly',
    run[19][0] > run[0][0] && steps.every(d => d > 0 && d < 0.007), {
      from: +run[0][0].toFixed(3), to: +run[19][0].toFixed(3),
      biggestStep: +Math.max(...steps).toFixed(4),
    });
  check('the slider and label follow the cycle',
    run.every(([h, lbl, val]) => /^\d{1,2}:[0-5]\d$/.test(lbl) && Math.abs(val - h) <= 0.05),
    run[19]);

  // Dragging while it runs has to win, or the next frame overwrites the drag.
  await setHour(18.98);
  const grabbed = await p.evaluate(() => [window.__api.CFG.dayCycle,
                                          document.getElementById('cfg-daycycle').checked]);
  check('dragging the hour slider stops the cycle', grabbed[0] === false && grabbed[1] === false, grabbed);

  await cycle(true);
  let wrapped = true;
  await p.waitForFunction(() => window.__api.CFG.hour < 7, null, { timeout: 15000 })
    .catch(() => { wrapped = false; });
  check('the cycle wraps past dusk back to dawn', wrapped, await p.evaluate(() => window.__api.CFG.hour));
  await cycle(false);
  await setHour(13);

  // -- 7bb. modules over the homes -------------------------------------------
  // The membrane is an opening over each home, ringed by a beam at anchor
  // height. Modules span that opening flat, hung off the ring.
  const roofPan = await p.evaluate(() => {
    const pv = window.__api.panelVerts, CFG = window.__api.CFG;
    const h = CFG.home / 2;
    const inHome = (x, z) => {
      for (let i = 0; i < CFG.grid; i++)
        for (let j = 0; j < CFG.grid; j++)
          if (Math.abs(x - i * CFG.pitch) <= h && Math.abs(z - j * CFG.pitch) <= h) return true;
      return false;
    };
    let over = 0, whollyOver = 0, offRing = 0, worst = 0;
    for (let q = 0; q < pv.length; q += 12) {
      const cx = (pv[q] + pv[q + 3] + pv[q + 6] + pv[q + 9]) / 4;
      const cz = (pv[q + 2] + pv[q + 5] + pv[q + 8] + pv[q + 11]) / 4;
      if (!inHome(cx, cz)) continue;
      over++;
      // Near the ring the bilinear sample picks up the membrane just outside it,
      // so allow an inch rather than demanding exactly the beam height.
      for (let k = 0; k < 4; k++) {
        const d = Math.abs(pv[q + k * 3 + 1] - CFG.mast);
        if (d > worst) worst = d;
      }
    }
    return { over, worst: +worst.toFixed(3), mast: CFG.mast, diag: window.__diag.roofPanels };
  });
  check('modules hang across the openings over the homes',
    roofPan.over > 0 && roofPan.over === roofPan.diag, roofPan);
  check('they hang flat off the perimeter beam, not down into the canopy',
    roofPan.worst < 0.1, roofPan);

  // -- 7c. where on Earth, and when ------------------------------------------
  // Solar geometry first, against numbers that do not depend on this code:
  // day length at the equator is ~12 h all year, and the hemispheres are
  // opposite each other.
  const solar = await p.evaluate(() => {
    const H = (lat, day) => window.__api.halfDay(lat, day) * 2;
    return {
      equatorJun: H(0, 172), equatorDec: H(0, 355),
      northJun: H(40.4, 172), northDec: H(40.4, 355),
      southJun: H(-23.7, 172), southDec: H(-23.7, 355),
      noonEl: window.__api.solarPos(30.9, 172, 12).el * 180 / Math.PI,
      dawnAz: window.__api.solarPos(30.9, 172, 7).az * 180 / Math.PI,
      duskAz: window.__api.solarPos(30.9, 172, 17).az * 180 / Math.PI,
    };
  });
  check('day length at the equator barely moves with the season',
    Math.abs(solar.equatorJun - 12) < 0.2 && Math.abs(solar.equatorDec - 12) < 0.2, solar);
  check('the hemispheres run opposite seasons',
    solar.northJun > solar.northDec && solar.southDec > solar.southJun,
    { north: [solar.northJun, solar.northDec], south: [solar.southJun, solar.southDec] });
  check('midsummer noon at 31°N puts the sun near the zenith',
    solar.noonEl > 80 && solar.noonEl < 84, solar.noonEl);
  check('the sun rises in the east and sets in the west',
    solar.dawnAz > 0 && solar.dawnAz < 180 && solar.duskAz > 180, [solar.dawnAz, solar.duskAz]);

  // The insolation job runs off the frame loop, so wait on its own counter and
  // on the full-resolution pass, not the coarse one that lands first.
  const sunAct = async fn => {
    const s0 = await p.evaluate(() => window.__sun.seq);
    await fn();
    await p.waitForFunction(s => window.__sun.seq > s && !window.__sun.coarse, s0, { timeout: 20000 });
    return p.evaluate(() => window.__sun);
  };
  const setSite = i => sunAct(() => p.evaluate(i => document.getElementById('site-' + i).click(), i));
  const setDay = d => sunAct(() => p.evaluate(d => {
    const el = document.getElementById('cfg-day'); el.value = d;
    el.dispatchEvent(new Event('input'));
  }, d));

  let sun = await p.evaluate(() => window.__sun);
  check('the sun map covers the block and finishes', sun.nx > 20 && sun.mean > 0 && !sun.coarse, sun);
  check('shaded ground gets less sun than open sky', sun.mean < sun.open * 0.95, [sun.mean, sun.open]);

  const kubuqiJun = await setSite(4);            // 40.4°N
  const kubuqiDec = await setDay(355);
  check('a northern winter cuts the day and the sun with it',
    kubuqiDec.hours < kubuqiJun.hours - 3 && kubuqiDec.open < kubuqiJun.open * 0.6,
    { jun: [kubuqiJun.hours, kubuqiJun.open], dec: [kubuqiDec.hours, kubuqiDec.open] });

  const aliceDec = await setSite(9);              // 23.7°S, so December is summer
  check('the same date is summer south of the equator', aliceDec.hours > kubuqiDec.hours + 3,
    { alice: aliceDec.hours, kubuqi: kubuqiDec.hours });
  check('the season label names the local season',
    /21 Dec · (high summer|summer)/.test(await p.evaluate(() => document.getElementById('lbl-day').textContent)),
    await p.evaluate(() => document.getElementById('lbl-day').textContent));

  await setSite(0);
  await setDay(172);

  // Modules are the only thing between the ground and the sun here, so their
  // coverage has to move the map. This is the check that the shadow raster is
  // actually rasterising anything.
  const roofFrac = () => p.evaluate(() => {
    const ps = window.__api.sunmap.patches.filter(q => q.where === 'roof');
    return ps.reduce((a, q) => a + q.frac, 0) / Math.max(1, ps.length);
  });
  const covered = await sunAct(() => p.evaluate(() => {
    const el = document.getElementById('cfg-cov'); el.value = 100;
    el.dispatchEvent(new Event('input'));
  }));
  const roofCovered = await roofFrac();
  const bare = await sunAct(() => p.evaluate(() => {
    const el = document.getElementById('cfg-cov'); el.value = 0;
    el.dispatchEvent(new Event('input'));
  }));
  const roofBare = await roofFrac();
  check('modules over a home shade that home\'s roof', roofCovered < roofBare * 0.6,
    { covered: roofCovered.toFixed(2), bare: roofBare.toFixed(2) });
  check('full module coverage darkens the ground, none leaves it lit',
    covered.mean < bare.mean * 0.55 && bare.mean > bare.open * 0.85,
    { covered: Math.round(covered.mean), bare: Math.round(bare.mean), open: Math.round(bare.open) });
  check('deep shade grows a different mix from full sun',
    JSON.stringify(covered.counts) !== JSON.stringify(bare.counts),
    { covered: covered.counts, bare: bare.counts });
  // The point of the whole thing: unshaded desert stays bare, shaded ground
  // comes into cover. If this ever inverts, the growth model is upside down.
  check('bare desert greens up once the canopy shades it',
    bare.green < 0.2 && covered.green > 0.55,
    { open: bare.green.toFixed(2), shaded: covered.green.toFixed(2) });

  await sunAct(() => p.evaluate(() => {
    const el = document.getElementById('cfg-cov'); el.value = 50;
    el.dispatchEvent(new Event('input'));
  }));

  // Rising/falling edge throttle: a drag must not queue a run per event. Fired
  // in one go on purpose — a real drag lands its events over a few frames, and
  // spacing them out here would only measure this harness's timer throttling.
  const runs0 = await p.evaluate(() => window.__sun.starts);
  await p.evaluate(() => {
    const el = document.getElementById('cfg-water');
    for (let i = 0; i < 20; i++) { el.value = 5 * i; el.dispatchEvent(new Event('input')); }
  });
  await p.waitForFunction(() => !window.__sun.coarse, null, { timeout: 20000 });
  await p.waitForTimeout(500);
  const runs = await p.evaluate(() => window.__sun.starts) - runs0;
  check('20 slider events collapse to at most two passes', runs >= 1 && runs <= 2, { runs });

  // Rising edge: the first change after a pause has to answer at once, which is
  // what the draft pass is for. It must land before the full pass is even due.
  await p.waitForTimeout(1100);
  const seq0 = await p.evaluate(() => window.__sun.seq);
  await p.evaluate(() => {
    const el = document.getElementById('cfg-water'); el.value = 60;
    el.dispatchEvent(new Event('input'));
  });
  const draft = await p.waitForFunction(s => window.__sun.seq > s ? window.__sun : null,
    seq0, { timeout: 5000 }).then(h => h.jsonValue());
  check('the first change after a pause answers straight away with a draft',
    draft.coarse === true && draft.nx < 60, { coarse: draft.coarse, cells: draft.nx });
  const settled = await p.waitForFunction(s => window.__sun.seq > s && !window.__sun.coarse ? window.__sun : null,
    draft.seq, { timeout: 20000 }).then(h => h.jsonValue());
  check('the draft is then replaced by the full-resolution pass',
    settled.nx > draft.nx, { draft: draft.nx, full: settled.nx });
  check('the full pass is what ends up on screen',
    (await p.evaluate(() => window.__sun)).coarse === false);

  // Toggling either display works off the map already in hand: it must redraw
  // without starting another pass over the geometry.
  const starts0 = await p.evaluate(() => window.__sun.starts);
  await p.evaluate(() => document.getElementById('cfg-sunmap').click());
  await p.waitForTimeout(150);
  const heat = await p.evaluate(() => {
    let n = 0, w = 0;
    window.__api.heat.traverse(o => {
      if (o.material && o.material.map && o.material.map.image) { n++; w = o.material.map.image.width; }
    });
    return { n, w, want: window.__sun.nx, starts: window.__sun.starts };
  });
  check('the sun map draws one texture at the grid resolution, with no recompute',
    heat.n === 1 && heat.w === heat.want && heat.starts === starts0, heat);
  await p.evaluate(() => document.getElementById('cfg-sunmap').click());

  const growthTex = () => p.evaluate(() => {
    let n = 0;
    window.__api.growth.traverse(o => { if (o.material && o.material.map) n++; });
    return n;
  });
  const greenOn = await growthTex();
  await p.evaluate(() => document.getElementById('cfg-growth').click());
  await p.waitForTimeout(150);
  const greenOff = await growthTex();
  check('the green ground tint draws and clears', greenOn === 1 && greenOff === 0,
    { on: greenOn, off: greenOff });
  await p.evaluate(() => document.getElementById('cfg-growth').click());
  await p.waitForTimeout(150);

  const instances = () => p.evaluate(() => {
    let n = 0;
    window.__api.plants.traverse(o => { if (o.isInstancedMesh) n += o.count; });
    return n;
  });
  const planted = await instances();
  await p.evaluate(() => document.getElementById('cfg-plants').click());
  await p.waitForTimeout(150);
  const cleared = await instances();
  check('planting puts instances in the scene and takes them out again',
    planted > 50 && cleared === 0, { planted, cleared });
  await p.evaluate(() => document.getElementById('cfg-plants').click());
  await p.waitForTimeout(200);

  // -- 8. neighbourhood config ----------------------------------------------
  for (const g of ['2', '5', '3']) {
    await setField('cfg-grid', g);
    const d = await diag();
    check(`grid ${g}x${g} builds`, d.nodes > 0 && (await surf()).nan === 0, { homes: g * g, nodes: d.nodes });
  }

  await setField('cfg-home', '48');
  check('a home wider than the gap still builds', (await surf()).nan === 0);
  await setField('cfg-home', '32');

  await setField('cfg-mast', '55');
  s = await surf();
  check('an anchor above the peak still builds', s.nan === 0 && s.max >= 46, s);
  await setField('cfg-mast', '30');

  // -- 9. style / resolution / toggles --------------------------------------
  for (const st of ['fabric', 'none', 'net']) {
    await setField('cfg-style', st);
    check(`style "${st}" renders`, errs.length === 0);
  }
  for (const r of ['4', '1.5', '2.5']) {
    await setField('cfg-res', r);
    check(`resolution ${r} ft builds`, (await surf()).nan === 0, { nodes: (await diag()).nodes });
  }
  for (const id of ['cfg-controlnet', 'cfg-masts', 'cfg-homes', 'cfg-shadows']) {
    await click(id);
    await click(id);
    check(`toggle ${id} round-trips`, errs.length === 0);
  }

  // -- 10. views and resize --------------------------------------------------
  for (const v of ['v-over', 'v-top', 'v-street']) {
    await p.evaluate(v => document.getElementById(v).click(), v);
    await settle(200);
  }
  check('camera presets run clean', errs.length === 0);
  const inside = await p.evaluate(() => {
    document.getElementById('v-over').click();
    // The overview camera must sit outside and above the canopy.
    return { y: camera.position.y, peak: window.__diag.peak };
  });
  check('overview camera is above the structure', inside.y > inside.peak, inside);

  await p.setViewportSize({ width: 700, height: 500 });
  await settle(300);
  const asp = await p.evaluate(() => [camera.aspect, renderer.domElement.width / renderer.domElement.height]);
  check('resize updates the camera aspect', Math.abs(asp[0] - asp[1]) < 0.02, asp);
  await p.setViewportSize({ width: 1280, height: 800 });
  await settle(300);

  // -- 11. export ------------------------------------------------------------
  const obj = await p.evaluate(async () => {
    let captured = null;
    const orig = URL.createObjectURL;
    URL.createObjectURL = b => { captured = b; return orig.call(URL, b); };
    document.getElementById('btn-obj').click();
    URL.createObjectURL = orig;
    return captured ? await captured.text() : null;
  });
  check('OBJ export produces vertices and faces',
    !!obj && /^v /m.test(obj) && /^f /m.test(obj) && !/NaN/.test(obj),
    obj ? { bytes: obj.length, v: (obj.match(/^v /gm) || []).length, f: (obj.match(/^f /gm) || []).length } : null);

  const json = await p.evaluate(async () => {
    let captured = null;
    const orig = URL.createObjectURL;
    URL.createObjectURL = b => { captured = b; return orig.call(URL, b); };
    document.getElementById('btn-json').click();
    URL.createObjectURL = orig;
    return captured ? await captured.text() : null;
  });
  let parsed = null;
  try { parsed = JSON.parse(json); } catch (e) { }
  check('JSON export round-trips', !!parsed && Array.isArray(parsed.nodes) && !!parsed.config, parsed && Object.keys(parsed));

  console.log('\nconsole/page errors:', errs.length ? '\n' + errs.join('\n') : '(none)');
  check('no uncaught errors during the whole pass', errs.length === 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
