import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false, // Frameless for the glass effect
    transparent: true, // Enable transparency
    hasShadow: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, // Simplified for this example; allows access to node in renderer if needed
      webSecurity: false // Allow loading local resources comfortably
    },
    icon: path.join(__dirname, '../public/icon.png') // Assumes you might add an icon later
  });

  // In development, load from Vite server. In production, load from built file.
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    // mainWindow.webContents.openDevTools({ mode: 'detach' }); // Optional: Open DevTools
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Ensure the window is always on top if desired, or remove this line for standard behavior
  // mainWindow.setAlwaysOnTop(true, 'floating');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if ((process as any).platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});