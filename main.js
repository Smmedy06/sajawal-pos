const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// Ensure high-res SP icon is synced to build folder
const generatedIconPath = 'C:/Users/HP/.gemini/antigravity-ide/brain/587ad177-5d1b-4071-8c2e-eb61b23b6007/sp_app_icon_1786006984270.png';
const buildDir = path.join(__dirname, 'build');
if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir, { recursive: true });
}
if (fs.existsSync(generatedIconPath)) {
  try {
    fs.copyFileSync(generatedIconPath, path.join(buildDir, 'icon.png'));
    fs.copyFileSync(generatedIconPath, path.join(buildDir, 'icon.ico'));
  } catch (err) {
    console.log('Icon sync note:', err.message);
  }
}

let mainWindow;

function createWindow() {
  const iconPath = fs.existsSync(path.join(buildDir, 'icon.png')) ? path.join(buildDir, 'icon.png') : undefined;

  mainWindow = new BrowserWindow({
    width: 1366,
    height: 850,
    minWidth: 1024,
    minHeight: 700,
    title: "Sajawal POS — Beauty & Cosmetics Desktop System",
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// IPC Handler for Thermal Printing
ipcMain.on('print-receipt', (event, options) => {
  if (mainWindow) {
    mainWindow.webContents.print({
      silent: false,
      printBackground: true,
      deviceName: options?.printerName || ''
    });
  }
});
