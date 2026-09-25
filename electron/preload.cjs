const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  openCircuit: () => ipcRenderer.invoke('circuit:open'),
  saveCircuit: (content, name) => ipcRenderer.invoke('circuit:save', content, name),
});
