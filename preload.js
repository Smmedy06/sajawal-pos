// Narrow, explicit bridge between the screen and the main process.
// The page cannot reach Node.js or Electron directly (contextIsolation + sandbox).
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('bridge', {
  api: (name, payload) => invoke('api', name, payload),
  appInfo: () => invoke('app:info'),
  printers: () => invoke('print:printers'),
  printDocument: (opts) => invoke('print:document', opts),
  savePdf: (opts) => invoke('print:pdf', opts),
  saveFile: (opts) => invoke('file:save', opts),
  openFile: (opts) => invoke('file:open', opts),
  openFolder: (which) => invoke('shell:open-folder', { which }),
  pickFolder: () => invoke('dialog:pick-folder'),
  backupList: () => invoke('backup:list'),
  backupNow: () => invoke('backup:now'),
  backupCreate: () => invoke('backup:create'),
  backupRestore: (file) => invoke('backup:restore', { file }),
  clearData: (confirmText) => invoke('data:clear', { confirmText }),
  closeAck: () => invoke('app:close-ack'),
  confirmClose: () => invoke('app:confirm-close'),
  onBeforeClose: (fn) => {
    ipcRenderer.removeAllListeners('app:before-close');
    ipcRenderer.on('app:before-close', () => fn());
  }
});
