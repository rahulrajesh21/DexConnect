import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEXCONNECT_CHANNELS } from '../../electron/main/ipc/channels';
import type { LaunchConfig, PairWirelessPayload } from '../../src/types';

// Mock electron ipcRenderer
const listeners = new Map<string, Array<(...args: any[]) => void>>();
const mockInvoke = vi.fn();
const mockOn = vi.fn((channel: string, handler: (...args: any[]) => void) => {
  if (!listeners.has(channel)) {
    listeners.set(channel, []);
  }
  listeners.get(channel)!.push(handler);
});
const mockRemoveListener = vi.fn((channel: string, handler: (...args: any[]) => void) => {
  const channelListeners = listeners.get(channel);
  if (channelListeners) {
    const idx = channelListeners.indexOf(handler);
    if (idx !== -1) {
      channelListeners.splice(idx, 1);
    }
  }
});

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: (...args: any[]) => mockInvoke(...args),
    on: (...args: any[]) => (mockOn as any)(...args),
    removeListener: (...args: any[]) => (mockRemoveListener as any)(...args),
  },
}));

// Import preload API after electron mock
import { dexconnectAPI } from '../../electron/preload/api';

describe('Preload dexconnectAPI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listeners.clear();
  });

  it('getDevices invokes GET_DEVICES channel', async () => {
    mockInvoke.mockResolvedValueOnce([{ serial: 'ABC' }]);
    const res = await dexconnectAPI.getDevices();
    expect(mockInvoke).toHaveBeenCalledWith(DEXCONNECT_CHANNELS.GET_DEVICES);
    expect(res).toEqual([{ serial: 'ABC' }]);
  });

  it('getSystemStatus invokes GET_SYSTEM_STATUS channel', async () => {
    mockInvoke.mockResolvedValueOnce({ adb: true, scrcpy: true });
    const res = await dexconnectAPI.getSystemStatus();
    expect(mockInvoke).toHaveBeenCalledWith(DEXCONNECT_CHANNELS.GET_SYSTEM_STATUS);
    expect(res).toEqual({ adb: true, scrcpy: true });
  });

  it('launchSession invokes LAUNCH_SESSION with config', async () => {
    const config: LaunchConfig = {
      serial: 'R5CW10ABCDE',
      profile: 'samsung_dex',
      resolution: '1440p',
      dpi: 240,
      refreshRate: 60,
      codec: 'h264',
      audioRouting: true,
      modelName: 'SM-S928B',
    };
    mockInvoke.mockResolvedValueOnce({ success: true, sessionId: 'session_123' });
    const res = await dexconnectAPI.launchSession(config);
    expect(mockInvoke).toHaveBeenCalledWith(DEXCONNECT_CHANNELS.LAUNCH_SESSION, config);
    expect(res.sessionId).toBe('session_123');
  });

  it('stopSession invokes STOP_SESSION with sessionId', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true });
    const res = await dexconnectAPI.stopSession('session_123');
    expect(mockInvoke).toHaveBeenCalledWith(DEXCONNECT_CHANNELS.STOP_SESSION, 'session_123');
    expect(res.success).toBe(true);
  });

  it('getActiveSessions invokes GET_ACTIVE_SESSIONS', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    const res = await dexconnectAPI.getActiveSessions();
    expect(mockInvoke).toHaveBeenCalledWith(DEXCONNECT_CHANNELS.GET_ACTIVE_SESSIONS);
    expect(res).toEqual([]);
  });

  it('migrateToWireless invokes MIGRATE_WIRELESS with serial', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, ip: '192.168.1.101' });
    const res = await dexconnectAPI.migrateToWireless('R5CW10ABCDE');
    expect(mockInvoke).toHaveBeenCalledWith(DEXCONNECT_CHANNELS.MIGRATE_WIRELESS, 'R5CW10ABCDE');
    expect(res.ip).toBe('192.168.1.101');
  });

  it('pairWirelessDevice invokes PAIR_WIRELESS_DEVICE with payload', async () => {
    const payload: PairWirelessPayload = {
      ip: '192.168.1.101',
      pairingPort: 38192,
      code: '123456',
      connectPort: 5555,
    };
    mockInvoke.mockResolvedValueOnce({ success: true });
    const res = await dexconnectAPI.pairWirelessDevice(payload);
    expect(mockInvoke).toHaveBeenCalledWith(DEXCONNECT_CHANNELS.PAIR_WIRELESS_DEVICE, payload);
    expect(res.success).toBe(true);
  });

  it('connectWirelessDevice invokes CONNECT_WIRELESS_DEVICE with address', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true });
    const res = await dexconnectAPI.connectWirelessDevice('192.168.1.101:5555');
    expect(mockInvoke).toHaveBeenCalledWith(DEXCONNECT_CHANNELS.CONNECT_WIRELESS_DEVICE, '192.168.1.101:5555');
    expect(res.success).toBe(true);
  });

  it('getRecentWirelessDevices invokes GET_RECENT_WIRELESS_DEVICES', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    const res = await dexconnectAPI.getRecentWirelessDevices();
    expect(mockInvoke).toHaveBeenCalledWith(DEXCONNECT_CHANNELS.GET_RECENT_WIRELESS_DEVICES);
    expect(res).toEqual([]);
  });

  it('onDevicesUpdated attaches listener and returns working unsubscribe callback', () => {
    const callback = vi.fn();
    const unsubscribe = dexconnectAPI.onDevicesUpdated(callback);

    expect(mockOn).toHaveBeenCalledWith(DEXCONNECT_CHANNELS.DEVICES_UPDATED, expect.any(Function));

    // Simulate event delivery from main process
    const registeredHandler = mockOn.mock.calls[0][1];
    const fakeDevices = [{ serial: 'TEST123' }];
    registeredHandler({} /* fake event */, fakeDevices);

    expect(callback).toHaveBeenCalledWith(fakeDevices);

    // Call unsubscribe
    unsubscribe();
    expect(mockRemoveListener).toHaveBeenCalledWith(
      DEXCONNECT_CHANNELS.DEVICES_UPDATED,
      registeredHandler
    );
  });

  it('onSessionStatusChanged attaches listener and handles unsubscription', () => {
    const callback = vi.fn();
    const unsubscribe = dexconnectAPI.onSessionStatusChanged(callback);

    expect(mockOn).toHaveBeenCalledWith(DEXCONNECT_CHANNELS.SESSION_STATUS_CHANGED, expect.any(Function));
    const registeredHandler = mockOn.mock.calls[0][1];
    const fakeSession = { sessionId: 's1', status: 'running' };
    registeredHandler({}, fakeSession);

    expect(callback).toHaveBeenCalledWith(fakeSession);

    unsubscribe();
    expect(mockRemoveListener).toHaveBeenCalledWith(
      DEXCONNECT_CHANNELS.SESSION_STATUS_CHANGED,
      registeredHandler
    );
  });

  it('onSessionLog attaches listener and handles unsubscription', () => {
    const callback = vi.fn();
    const unsubscribe = dexconnectAPI.onSessionLog(callback);

    expect(mockOn).toHaveBeenCalledWith(DEXCONNECT_CHANNELS.SESSION_LOG, expect.any(Function));
    const registeredHandler = mockOn.mock.calls[0][1];
    const fakeLog = { sessionId: 's1', text: 'Connecting...' };
    registeredHandler({}, fakeLog);

    expect(callback).toHaveBeenCalledWith(fakeLog);

    unsubscribe();
    expect(mockRemoveListener).toHaveBeenCalledWith(
      DEXCONNECT_CHANNELS.SESSION_LOG,
      registeredHandler
    );
  });
});
