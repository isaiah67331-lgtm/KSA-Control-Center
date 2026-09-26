const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ksa', Object.fromEntries(
  ['state', 'set-mod', 'reset-mods', 'pick-path', 'set-gpu', 'open', 'source', 'backup', 'close', 'launch', 'install']
    .map(name => [name, (...args) => ipcRenderer.invoke(name, ...args)])
));
