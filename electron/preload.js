/**
 * Preload — exposes a tiny, safe bridge to the renderer.
 * The renderer keeps using the standard WebHID API; this only adds
 * environment information and device-arrival notifications.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mq80', {
  isDesktop: true,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  onDeviceAdded: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('mq80:device-added', handler);
    return () => ipcRenderer.removeListener('mq80:device-added', handler);
  },
});
