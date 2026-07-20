const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pinglab', {
  runTest: () => ipcRenderer.invoke('run-test'),
  getState: () => ipcRenderer.invoke('get-state'),
  tunnelStatus: () => ipcRenderer.invoke('tunnel-status'),
  tunnelToggle: on => ipcRenderer.invoke('tunnel-toggle', on),
  installWireGuard: () => ipcRenderer.invoke('install-wireguard'),
  monitorStart: () => ipcRenderer.invoke('monitor-start'),
  monitorStop: () => ipcRenderer.invoke('monitor-stop'),
  quickProbe: () => ipcRenderer.invoke('quick-probe'),
  onMonitorSample: cb => ipcRenderer.on('monitor-sample', (_e, s) => cb(s)),
  capture: file => ipcRenderer.invoke('capture', file),
  onProgress: cb => ipcRenderer.on('progress', (_e, data) => cb(data)),
});
