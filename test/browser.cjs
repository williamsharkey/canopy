// Shared Chromium launch options.
//
// The pinned build under /opt only exists on the machine these tests were first
// written on. Use it when it is there, otherwise fall back to whatever browser
// `npx playwright install chromium` put in place, so the suite runs anywhere.
const fs = require('fs');

const PINNED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

function launchOpts() {
  const exe = process.env.CHROME_PATH || PINNED;
  const opts = { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] };
  if (fs.existsSync(exe)) opts.executablePath = exe;
  return opts;
}

module.exports = { launchOpts };
