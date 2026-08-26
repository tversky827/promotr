import { chromium } from 'playwright-core';
import fs from 'node:fs';

const [,, url, out, mode = 'light', width = '1440', full = 'true'] = process.argv;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({
  viewport: { width: Number(width), height: 900 },
  colorScheme: mode === 'dark' ? 'dark' : 'light',
  deviceScaleFactor: 2,
});
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const res = await page.goto(url, { waitUntil: 'load', timeout: 45000 });
await page.waitForTimeout(600);
await page.screenshot({ path: out, fullPage: full === 'true' });
console.log(JSON.stringify({ status: res?.status(), errors }, null, 1));
await browser.close();
