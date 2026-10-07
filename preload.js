const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  printReceipt: (options) => ipcRenderer.send('print-receipt', options)
});
