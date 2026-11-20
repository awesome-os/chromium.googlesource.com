const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('b8gIde', {
  getWorkspaceInfo: () => ipcRenderer.invoke('vscode:workspaceInfo'),
  listDir: (relPath) => ipcRenderer.invoke('vscode:listDir', relPath),
  readFile: (relPath) => ipcRenderer.invoke('vscode:readFile', relPath),
  writeFile: (relPath, content) => ipcRenderer.invoke('vscode:writeFile', relPath, content),
});
