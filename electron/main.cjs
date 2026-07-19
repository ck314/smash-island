const { app, BrowserWindow, session } = require('electron');
const path = require('node:path');

const DEV = !app.isPackaged;
const DEV_URL = 'http://localhost:5173';

function setCsp() {
  // Permits inline on*= handlers (we keep them this pass) and bundled assets only.
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self' ws: http://localhost:5173 https://api.anthropic.com",
  ].join('; ');
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200, height: 800, backgroundColor: '#88cdf2',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (DEV) {
    win.loadURL(DEV_URL);
  } else {
    // Real origin, never bare file:// — localStorage/BStore need a proper origin.
    win.loadURL('app://index.html');
  }
}

// Register a real-origin protocol for the packaged build (prod parity task wires dist/ here).
if (!DEV) {
  const { protocol } = require('electron');
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

app.whenReady().then(() => {
  setCsp();
  if (!DEV) {
    const { protocol, net } = require('electron');
    protocol.handle('app', (req) => {
      const url = new URL(req.url);
      const file = path.join(__dirname, '..', 'dist', url.hostname + url.pathname);
      return net.fetch('file://' + file);
    });
  }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
