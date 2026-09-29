import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('node:fs/promises');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'NAPS',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'electron', 'preload.cjs'),
    },
  });

  const distIndexPath = path.join(__dirname, 'dist', 'index.html');
  win.loadFile(distIndexPath);
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('will-prevent-unload', event => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question', title: 'Несохранённые изменения',
      message: 'Закрыть приложение без сохранения схемы?',
      buttons: ['Продолжить работу', 'Закрыть без сохранения'], defaultId: 0, cancelId: 0,
    });
    if (choice === 1) event.preventDefault();
  });
}

app.whenReady().then(() => {
  const filters = [{ name: 'Схемы NAPS', extensions: ['scm'] }];
  ipcMain.handle('circuit:open', async event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || event.senderFrame !== event.sender.mainFrame) throw new Error('Недоступное окно.');
    const result = await dialog.showOpenDialog(win, { title: 'Открыть схему', filters, properties: ['openFile'] });
    if (result.canceled) return null;
    const filePath = result.filePaths[0];
    if ((await fs.stat(filePath)).size > 10 * 1024 * 1024) throw new Error('Файл слишком большой (максимум 10 МБ).');
    return { name: path.basename(filePath), content: await fs.readFile(filePath, 'utf8') };
  });
  ipcMain.handle('circuit:save', async (event, content, name) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || event.senderFrame !== event.sender.mainFrame) throw new Error('Недоступное окно.');
    if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > 10 * 1024 * 1024 || typeof name !== 'string') throw new Error('Некорректные данные схемы.');
    const result = await dialog.showSaveDialog(win, { title: 'Сохранить схему', filters, defaultPath: path.basename(name) });
    if (result.canceled || !result.filePath) return null;
    // Write beside the destination first: a failed write must not truncate an
    // existing project. Renaming within one directory replaces it atomically.
    const temporaryPath = path.join(path.dirname(result.filePath), `.${path.basename(result.filePath)}.${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx' });
      await fs.rename(temporaryPath, result.filePath);
    } finally {
      await fs.rm(temporaryPath, { force: true });
    }
    return path.basename(result.filePath);
  });
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
