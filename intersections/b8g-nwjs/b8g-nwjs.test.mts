import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchNwApp } from './index.mts';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('B8G-NW.js injects nw.*, process, and require(os/fs/path) directly into real Chromium DOM', async () => {
  const win = await launchNwApp(join(__dirname, 'demo-app'), { headless: true, show: false });
  try {
    const res = await win.webContents.executeJavaScript<{
      appName: string;
      nwVer: string;
      hostname: string;
      files: string[];
    }>(`
      (async () => {
        const os = require('os');
        const fs = require('fs');
        const files = await fs.promises.readdir('.');
        return {
          appName: nw.App.manifest.name,
          nwVer: process.versions.nw,
          hostname: os.hostname(),
          files,
        };
      })()
    `);

    assert.equal(res.appName, 'b8g-nwjs-demo-app');
    assert.equal(res.nwVer, 'b8g-nwjs-0.1.0');
    assert.ok(res.hostname.length > 0);
    assert.ok(res.files.includes('package.json') && res.files.includes('index.html'));
  } finally {
    win.close();
  }
});
