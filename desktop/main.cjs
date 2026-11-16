'use strict';

const { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session, shell } = require('electron');
const path = require('node:path');
const { APP_ORIGIN, SCHEME, appURL, isWorkbench, externalURL, protocolHandler } = require('./protocol.cjs');
const { installEnvironment } = require('./environment.cjs');
const { inspectRequest } = require('./inspect.cjs');

app.setName('BioInfoBuddy');
app.enableSandbox();
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true,
} }]);

let mainWindow;
const previews = new Set();
const isolated = { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false };

function openWeb(raw) {
  const url = externalURL(raw);
  if (url) void shell.openExternal(url).catch(() => dialog.showErrorBox('链接打开失败', '请检查系统默认浏览器设置，再重试。'));
}

function guardWindow(win, allowNavigation) {
  const contents = win.webContents;
  contents.on('will-navigate', (event, url) => {
    if (allowNavigation(url)) return;
    event.preventDefault();
    openWeb(url);
  });
  contents.on('will-attach-webview', event => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    const local = appURL(url);
    if (win === mainWindow && local && /^\/resources\/v1\/(single-cell|spatial)\/figures\/[A-Za-z0-9_-]+\.png$/.test(local.pathname)) {
      const preview = new BrowserWindow({ width: 960, height: 720, title: 'BioInfoBuddy · 原图', autoHideMenuBar: true, webPreferences: isolated });
      previews.add(preview);
      preview.on('closed', () => previews.delete(preview));
      guardWindow(preview, next => next === local.href);
      void preview.loadURL(local.href).catch(() => preview.close());
    } else openWeb(url);
    return { action: 'deny' };
  });
}

function configureSession(ses) {
  ses.setPermissionRequestHandler((_contents, _permission, done) => done(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on('will-download', (event, item, contents) => {
    const url = item.getURL();
    if (contents !== mainWindow?.webContents || !(appURL(url) || url.startsWith('blob:' + APP_ORIGIN + '/'))) {
      event.preventDefault();
      return;
    }
    item.setSaveDialogOptions({ title: '保存文件', defaultPath: path.join(app.getPath('downloads'), path.basename(item.getFilename())) });
    item.once('done', (_event, state) => {
      if (state === 'interrupted') dialog.showErrorBox('保存失败', '请检查目标目录的磁盘空间与写入权限，再次下载。');
    });
  });
}

function configureMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: '文件', submenu: [{ role: process.platform === 'darwin' ? 'close' : 'quit' }] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '显示', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function openWorkbench() {
  if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.focus(); return; }
  mainWindow = new BrowserWindow({
    width: 1260, height: 820, minWidth: 640, minHeight: 540, show: false, autoHideMenuBar: true,
    backgroundColor: '#fafbfe', title: 'BioInfoBuddy',
    webPreferences: { ...isolated, preload: path.join(__dirname, 'preload.cjs') },
  });
  const win = mainWindow;
  guardWindow(win, isWorkbench);
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    mainWindow = undefined;
    for (const preview of previews) preview.close();
  });
  await win.loadURL(APP_ORIGIN + '/');
}

async function initialize() {
  const root = app.getAppPath();
  // In development Electron may be invoked directly with desktop/main.cjs.
  const project = path.resolve(__dirname, '..');
  const environmentDir = app.isPackaged ? path.join(process.resourcesPath, 'environment') : path.join(project, 'dist', 'desktop-environment');
  const { chatRequest } = await import('../serverless/chat-handler.mjs');
  protocol.handle(SCHEME, protocolHandler({
    client: path.join(app.isPackaged ? root : project, 'dist', 'desktop-client'),
    inspectRequest, chatRequest: body => chatRequest(body, (url, options) => net.fetch(url, { ...options, credentials: 'omit' })),
    fetchFile: url => net.fetch(url),
  }));
  ipcMain.handle('environment:install', async (event, id) => {
    const frame = event.senderFrame;
    if (event.sender !== mainWindow?.webContents || !frame || frame !== event.sender.mainFrame || !isWorkbench(frame.url)) throw new Error('请从工作台打开。');
    await installEnvironment(environmentDir, id);
  });
  configureSession(session.defaultSession);
  configureMenu();
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    void openWorkbench();
  });
  await openWorkbench();
  app.on('activate', () => { void openWorkbench(); });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.whenReady().then(initialize).catch(() => {
    dialog.showErrorBox('BioInfoBuddy 启动失败', '请重新安装 BioInfoBuddy 后打开。');
    app.quit();
  });
}
