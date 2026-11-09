/**
 * Electron main process — desktop shell for the MQ80 VIA driver.
 *
 * WebHID inside Electron needs three things:
 *   1. the `hid` permission check must succeed,
 *   2. a device permission handler must allow the device,
 *   3. the `select-hid-device` event must be answered with a device id.
 */
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const path = require('path');

const VENDOR_ID = 0x320f; // IQUNIX
const PRODUCT_ID = 0x5055; // MQ80

let mainWindow = null;

function configureHid(webContents) {
  const session = webContents.session;

  session.setPermissionCheckHandler((_wc, permission) => {
    if (permission === 'hid') return true;
    return true;
  });

  session.setDevicePermissionHandler((details) => {
    if (details.deviceType === 'hid') return true;
    return false;
  });

  let chooserOpen = false;
  session.on('select-hid-device', (event, details, callback) => {
    event.preventDefault();
    if (chooserOpen) return;
    chooserOpen = true;

    const devices = details.deviceList || [];
    const match =
      devices.find((d) => d.vendorId === VENDOR_ID && d.productId === PRODUCT_ID) ||
      devices.find((d) => d.usagePage === 0xff60 || d.usage === 0x61);

    const finish = (deviceId) => {
      chooserOpen = false;
      callback(deviceId);
    };

    if (match) {
      finish(match.deviceId);
      return;
    }
    if (!devices.length) {
      finish(undefined);
      return;
    }

    // Let the user pick when several HID devices are present.
    dialog
      .showMessageBox(mainWindow, {
        type: 'question',
        title: '选择设备',
        message: '请选择 IQUNIX MQ80 的 raw HID 接口',
        detail: devices
          .map((d, i) => `${i + 1}. ${d.name}  (${hex(d.vendorId)}:${hex(d.productId)})`)
          .join('\n'),
        buttons: [...devices.map((_, i) => `设备 ${i + 1}`), '取消'],
        cancelId: devices.length,
      })
      .then(({ response }) => finish(devices[response]?.deviceId));
  });

  session.on('hid-device-added', (_e, device) => {
    if (device.vendorId === VENDOR_ID && device.productId === PRODUCT_ID) {
      mainWindow?.webContents.send('mq80:device-added');
    }
  });
}

const hex = (n) => `0x${n.toString(16).toUpperCase().padStart(4, '0')}`;

function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [{ role: 'quit', label: '退出' }],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: 'VIA 协议文档',
          click: () => shell.openExternal('https://www.caniusevia.com/docs/specification'),
        },
        {
          label: 'the-via/app',
          click: () => shell.openExternal('https://github.com/the-via/app'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    title: 'IQUNIX MQ80 · VIA 驱动',
    backgroundColor: '#f5f6f8',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  configureHid(mainWindow.webContents);
  mainWindow.loadFile(path.join(__dirname, '..', 'app', 'index.html'));
  mainWindow.on('closed', () => (mainWindow = null));
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
