import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain } from './index.mts';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('B8G-Electron runs real Chromium with preload, contextBridge, ipcMain.handle, and webContents.send', async () => {
  await app.whenReady();

  ipcMain.handle('b8g:ping', async (_evt, msg: string) => ({
    pong: `echo:${msg}`,
    shared: true,
  }));

  let receivedSend = '';
  ipcMain.on('b8g:log', (evt, line: string) => {
    receivedSend = line;
    evt.reply('b8g:log-ack', `ack:${line}`);
  });

  let closedAll = false;
  app.once('window-all-closed', () => {
    closedAll = true;
  });

  const win = new BrowserWindow({
    width: 800,
    height: 600,
    show: false, // headless real Chromium
    webPreferences: {
      preload: join(__dirname, 'demo-app', 'preload.js'),
    },
  });

  try {
    await win.loadFile(join(__dirname, 'demo-app', 'index.html'));

    // 1. Verify contextBridge.exposeInMainWorld('b8gApi', ...)
    const hasApi = await win.webContents.executeJavaScript<boolean>('typeof window.b8gApi === "object"');
    assert.equal(hasApi, true, 'preload contextBridge must expose window.b8gApi');

    // 2. Verify ipcRenderer.invoke() <-> ipcMain.handle() round-trip
    const pingRes = await win.webContents.executeJavaScript<{ pong: string; shared: boolean }>(
      'window.b8gApi.ping("trojan-horse")',
    );
    assert.deepEqual(pingRes, { pong: 'echo:trojan-horse', shared: true });

    // 3. Verify ipcRenderer.send() -> ipcMain.on() -> event.reply()
    const ackRes = await win.webContents.executeJavaScript<string>(`
      new Promise((resolve) => {
        window.b8gApi.onLogAck((txt) => resolve(txt));
        window.b8gApi.sendLog('zero-copy');
      })
    `);
    assert.equal(receivedSend, 'zero-copy');
    assert.equal(ackRes, 'ack:zero-copy');

    // 4. Verify main -> renderer webContents.send()
    const tickPromise = win.webContents.executeJavaScript<number>(`
      new Promise((resolve) => {
        window.b8gApi.onTick((d) => resolve(d.tick));
      })
    `);
    // Give renderer a moment to attach listener, then push from main
    await new Promise((r) => setTimeout(r, 80));
    win.webContents.send('b8g:tick', { tick: 42, time: 'now' });
    const tickVal = await tickPromise;
    assert.equal(tickVal, 42);
  } finally {
    win.close();
    ipcMain.removeHandler('b8g:ping');
    ipcMain.removeAllListeners('b8g:log');
  }

  assert.equal(win.isDestroyed(), true);
  assert.equal(closedAll, true, 'window-all-closed must fire when last window closes');
});
