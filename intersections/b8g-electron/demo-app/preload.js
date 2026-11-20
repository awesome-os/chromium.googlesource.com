const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('b8gApi', {
  ping: (msg) => ipcRenderer.invoke('b8g:ping', msg),
  getSysInfo: () => ipcRenderer.invoke('b8g:sysinfo'),
  sendLog: (line) => ipcRenderer.send('b8g:log', line),
  onLogAck: (cb) => ipcRenderer.on('b8g:log-ack', (_e, text) => cb(text)),
  onTick: (cb) => ipcRenderer.on('b8g:tick', (_e, data) => cb(data)),
});
