import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getAdapters } from './factory';
import { registerIpcHandlers } from './ipc/handlers';
import { DeviceManager } from './services/DeviceManager';
import { SessionLauncher } from './services/SessionLauncher';
import { WirelessWizard } from './services/WirelessWizard';
import { DEXCONNECT_CHANNELS } from './ipc/channels';
import type { ActiveSession, SessionLogEntry } from '../../src/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Prevent duplicate application instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let deviceManager: DeviceManager | null = null;
let sessionLauncher: SessionLauncher | null = null;
let wirelessWizard: WirelessWizard | null = null;

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: 'DexConnect for Mac',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: '#0B0F17',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, '../preload/index.js'),
    },
  });

  // Safe external navigation
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Register adapters, DeviceManager, and SessionLauncher
  const adapters = getAdapters();
  if (!deviceManager) {
    deviceManager = new DeviceManager(adapters.adb, { autoStart: true });
    deviceManager.on('devices-updated', (devices) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(DEXCONNECT_CHANNELS.DEVICES_UPDATED, devices);
      }
    });
  }

  if (!sessionLauncher) {
    sessionLauncher = new SessionLauncher(adapters.scrcpy);
    sessionLauncher.on('session-status-changed', (session: ActiveSession) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const serializableSession: ActiveSession = {
          sessionId: session.sessionId,
          deviceSerial: session.deviceSerial,
          profile: session.profile,
          pid: session.pid,
          startedAt: session.startedAt,
          config: session.config ? { ...session.config } : session.config,
          status: session.status,
          ...(session.exitCode !== undefined ? { exitCode: session.exitCode } : {}),
          ...(session.error !== undefined ? { error: session.error } : {}),
        };
        mainWindow.webContents.send(DEXCONNECT_CHANNELS.SESSION_STATUS_CHANGED, serializableSession);
      }
    });
    sessionLauncher.on('session-log', (logEntry: SessionLogEntry) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(DEXCONNECT_CHANNELS.SESSION_LOG, logEntry);
      }
    });
  }

  if (!wirelessWizard) {
    wirelessWizard = new WirelessWizard(adapters.adb, {
      deviceManager: deviceManager ?? undefined,
    });

    wirelessWizard.on('qr-pairing-progress', (progress: any) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(DEXCONNECT_CHANNELS.QR_PAIRING_PROGRESS, progress);
      }
    });
  }

  registerIpcHandlers({
    ...adapters,
    deviceManager,
    sessionLauncher,
    wirelessWizard,
  });

  // Load dev server or production bundle
  if (process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    const distHtml = path.join(__dirname, '../../dist/index.html');
    const fallbackHtml = path.join(__dirname, '../renderer/index.html');
    const htmlPath = fs.existsSync(distHtml) ? distHtml : fallbackHtml;
    await mainWindow.loadFile(htmlPath);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('before-quit', () => {
  if (deviceManager) {
    deviceManager.dispose();
    deviceManager = null;
  }
  if (sessionLauncher) {
    sessionLauncher.dispose();
    sessionLauncher = null;
  }
  if (wirelessWizard) {
    wirelessWizard.dispose();
    wirelessWizard = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
