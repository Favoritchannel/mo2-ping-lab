const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pinglab', {
  runTest: () => ipcRenderer.invoke('run-test'),
  getState: () => ipcRenderer.invoke('get-state'),
  tunnelStatus: () => ipcRenderer.invoke('tunnel-status'),
  tunnelToggle: on => ipcRenderer.invoke('tunnel-toggle', on),
  installWireGuard: () => ipcRenderer.invoke('install-wireguard'),
  capture: file => ipcRenderer.invoke('capture', file),
  onProgress: cb => ipcRenderer.on('progress', (_e, data) => cb(data)),
});
