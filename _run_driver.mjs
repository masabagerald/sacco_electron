import { _electron as electron } from 'playwright-core';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = process.env.SCREENSHOT_DIR || 'C:\\Temp\\sacco-shots';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const electronBin = path.join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe');

console.log('Launching SACCO Pro...');
const app = await electron.launch({
  executablePath: electronBin,
  args: [__dirname],
  timeout: 30_000,
});

await new Promise(r => setTimeout(r, 6000));

const page = app.windows().find(w => !w.url().startsWith('devtools://')) ?? await app.firstWindow();
console.log('Windows:', app.windows().map(w => w.url()));

// Screenshot 1: initial state (login screen)
const shot1 = path.join(SHOT_DIR, '01-login.png');
await page.screenshot({ path: shot1 });
console.log('Screenshot 1 (login):', shot1);

// Fill in login
await page.evaluate(() => {
  document.getElementById('login-username').value = 'admin';
  document.getElementById('login-password').value = 'admin123';
});
await page.evaluate(() => document.querySelector('#login-form button[type="submit"]').click());

await new Promise(r => setTimeout(r, 3000));

const shot2 = path.join(SHOT_DIR, '02-dashboard.png');
await page.screenshot({ path: shot2 });
console.log('Screenshot 2 (dashboard):', shot2);

// Navigate to Members
await page.evaluate(() => document.querySelector('[data-page="members"]').click());
await new Promise(r => setTimeout(r, 1500));
const shot3 = path.join(SHOT_DIR, '03-members.png');
await page.screenshot({ path: shot3 });
console.log('Screenshot 3 (members):', shot3);

await app.close();
console.log('Done.');
