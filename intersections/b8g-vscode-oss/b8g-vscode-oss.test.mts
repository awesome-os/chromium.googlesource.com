import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchB8gVscode } from './b8g-vscode-shell.mts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(__dirname, '..', '..');

test('B8G Code-OSS boots on b8g-electron + shared Chromium and reads workspace files', async () => {
  const win = await launchB8gVscode(WORKSPACE_ROOT, { headless: true, show: false });
  try {
    const info = await win.webContents.executeJavaScript<{
      workspaceRoot: string;
      vscodeVersion: string;
      duplicatedChromiumMB: number;
    }>('window.b8gIde.getWorkspaceInfo()');

    assert.equal(info.duplicatedChromiumMB, 0);
    assert.ok(info.vscodeVersion.length > 0);

    const entries = await win.webContents.executeJavaScript<Array<{ name: string; isDir: boolean }>>(
      'window.b8gIde.listDir("docs/white-dragon-book")',
    );
    assert.ok(entries.some((e) => e.name === 'README.md'));
  } finally {
    win.close();
  }
});
