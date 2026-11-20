/**
 * Standard Electron-API Main Process running on B8G-Electron (0 MB duplicated Chromium!).
 */
import { cpus, totalmem, freemem, platform, release } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, resolveSharedChromeBinary } from '../index.mts';

const __dirname = dirname(fileURLToPath(import.meta.url));

ipcMain.handle('b8g:ping', async (_event, msg: string) => {
  return {
    pong: msg || 'hello',
    ts: Date.now(),
    pid: process.pid,
  };
});

ipcMain.handle('b8g:sysinfo', async () => {
  const cpuList = cpus();
  return {
    chromePath: resolveSharedChromeBinary(),
    duplicatedChromiumMB: 0,
    platform: `${platform()} ${release()}`,
    cpu: cpuList[0]?.model || 'Unknown CPU',
    cores: cpuList.length,
    totalRamGB: (totalmem() / 1024 ** 3).toFixed(1),
    freeRamGB: (freemem() / 1024 ** 3).toFixed(1),
    nodeVersion: process.version,
  };
});

ipcMain.on('b8g:log', (event, line: string) => {
  console.log(`[demo-app renderer -> main] ${line}`);
  event.reply('b8g:log-ack', `Main received: "${line}" at ${new Date().toLocaleTimeString()}`);
});

await app.whenReady();

const win = new BrowserWindow({
  width: 980,
  height: 640,
  title: 'B8G-Electron — Zero-Copy Shared Chromium Desktop App',
  webPreferences: {
    preload: join(__dirname, 'preload.js'),
    contextIsolation: true,
  },
});

await win.loadFile(join(__dirname, 'index.html'));

let tick = 0;
const timer = setInterval(() => {
  if (win.isDestroyed()) {
    clearInterval(timer);
    return;
  }
  tick++;
  win.webContents.send('b8g:tick', { tick, time: new Date().toLocaleTimeString() });
}, 1000);

app.on('window-all-closed', () => {
  clearInterval(timer);
  process.exit(0);
});
