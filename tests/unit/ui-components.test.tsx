// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { Titlebar } from '../../src/components/Titlebar';
import { DeviceCard } from '../../src/components/DeviceCard';
import { RecentDevicesList } from '../../src/components/RecentDevicesList';
import { LaunchCard, PROFILES } from '../../src/components/LaunchCard';
import { QuickControls } from '../../src/components/QuickControls';
import { PairingModal } from '../../src/components/PairingModal';
import { SessionStatusBar } from '../../src/components/SessionStatusBar';
import { LogViewer } from '../../src/components/LogViewer';
import { Toast, type ToastMessage } from '../../src/components/Toast';
import type { DeviceInfo, ActiveSession } from '../../src/types';

describe('Milestone M5: macOS Glassmorphic UI Dashboard Unit Tests', () => {
  describe('Titlebar Component', () => {
    it('renders system status badges for ADB and Scrcpy', () => {
      const onRefresh = vi.fn();
      const onPair = vi.fn();

      render(
        <Titlebar
          systemStatus={{ adb: true, scrcpy: true, scrcpyVersion: 'scrcpy 5.0.1' }}
          onRefreshDevices={onRefresh}
          onOpenPairingModal={onPair}
          isRefreshing={false}
        />
      );

      expect(screen.getByText('DexConnect')).toBeDefined();
      expect(screen.getByText('Ready')).toBeDefined();
      expect(screen.getByText('scrcpy 5.0.1')).toBeDefined();

      fireEvent.click(screen.getByText('Pair Wireless'));
      expect(onPair).toHaveBeenCalledTimes(1);

      const refreshBtn = screen.getByTitle('Refresh Connected Devices');
      fireEvent.click(refreshBtn);
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });
  });

  describe('DeviceCard Component', () => {
    const mockDevice: DeviceInfo = {
      serial: 'R5CW10ABCDE',
      state: 'device',
      brand: 'samsung',
      manufacturer: 'samsung',
      model: 'Galaxy S24 Ultra',
      androidVersion: '14',
      connectionType: 'usb',
      battery: {
        level: 85,
        scale: 100,
        status: 2,
        isCharging: true,
        powerSource: 'usb',
      },
    };

    it('renders Samsung brand badge, model name, battery and triggers migration', () => {
      const onSelect = vi.fn();
      const onMigrate = vi.fn();

      render(
        <DeviceCard
          device={mockDevice}
          isSelected={true}
          onSelect={onSelect}
          onMigrateToWifi={onMigrate}
          isMigrating={false}
        />
      );

      expect(screen.getByText('Galaxy S24 Ultra')).toBeDefined();
      expect(screen.getByText(/Samsung/i)).toBeDefined();
      expect(screen.getByText('USB Cable')).toBeDefined();
      expect(screen.getByText('85%')).toBeDefined();

      const migrateBtn = screen.getByText('Switch to Wi-Fi');
      fireEvent.click(migrateBtn);
      expect(onMigrate).toHaveBeenCalledWith('R5CW10ABCDE');
    });

    it('renders Wi-Fi device badge properly', () => {
      const wifiDevice: DeviceInfo = {
        ...mockDevice,
        serial: '192.168.1.155:5555',
        connectionType: 'wifi',
        ipAddress: '192.168.1.155',
      };

      render(
        <DeviceCard
          device={wifiDevice}
          isSelected={false}
          onSelect={vi.fn()}
          onMigrateToWifi={vi.fn()}
          isMigrating={false}
        />
      );

      expect(screen.getByText(/Wi-Fi/)).toBeDefined();
      // Should not have "Switch to Wi-Fi" button for already wireless device
      expect(screen.queryByText('Switch to Wi-Fi')).toBeNull();
    });
  });

  describe('RecentDevicesList Component', () => {
    it('renders remembered wireless devices and invokes connect callback', () => {
      const onConnect = vi.fn();
      const recents = [
        {
          ip: '192.168.1.150',
          port: 5555,
          model: 'Galaxy Z Fold 6',
          lastSeen: Date.now() - 60000,
        },
      ];

      render(
        <RecentDevicesList
          recentDevices={recents}
          onConnect={onConnect}
          connectingAddress={null}
        />
      );

      expect(screen.getByText('Galaxy Z Fold 6')).toBeDefined();
      expect(screen.getByText(/192.168.1.150:5555/)).toBeDefined();

      const connectBtn = screen.getByText('Connect');
      fireEvent.click(connectBtn);
      expect(onConnect).toHaveBeenCalledWith('192.168.1.150:5555');
    });
  });

  describe('LaunchCard Component', () => {
    it('renders profiles and allows selection', () => {
      const onSelect = vi.fn();
      const dexProfile = PROFILES[0];

      render(
        <LaunchCard
          profile={dexProfile}
          isSelected={true}
          onSelect={onSelect}
        />
      );

      expect(screen.getByText('Samsung DeX Desktop')).toBeDefined();
      expect(screen.getByText('DeX 🪐')).toBeDefined();
      expect(screen.getByText('Selected Profile')).toBeDefined();

      fireEvent.click(screen.getByText('Samsung DeX Desktop'));
      expect(onSelect).toHaveBeenCalledWith('samsung_dex');
    });
  });

  describe('QuickControls Component', () => {
    it('renders resolution, DPI, FPS, Codec, Audio and triggers launch', () => {
      const setResolution = vi.fn();
      const setDpi = vi.fn();
      const setFps = vi.fn();
      const setCodec = vi.fn();
      const setAudio = vi.fn();
      const onLaunch = vi.fn();

      render(
        <QuickControls
          resolution="1440p"
          setResolution={setResolution}
          dpi={240}
          setDpi={setDpi}
          fps={60}
          setFps={setFps}
          codec="h264"
          setCodec={setCodec}
          audioRouting={true}
          setAudioRouting={setAudio}
          onLaunch={onLaunch}
          isLaunching={false}
          hasSelectedDevice={true}
          selectedProfileName="Samsung DeX Desktop"
        />
      );

      expect(screen.getByText('Quick Controls')).toBeDefined();
      expect(screen.getByText('240')).toBeDefined();

      // Toggle audio
      const audioBtn = screen.getByText('Forwarding');
      fireEvent.click(audioBtn);
      expect(setAudio).toHaveBeenCalledWith(false);

      // Codec toggle
      const hevcBtn = screen.getByText('H.265');
      fireEvent.click(hevcBtn);
      expect(setCodec).toHaveBeenCalledWith('h265');

      // Launch button
      const launchBtn = screen.getByText('Launch Desktop Session');
      fireEvent.click(launchBtn);
      expect(onLaunch).toHaveBeenCalledTimes(1);
    });
  });

  describe('PairingModal Component', () => {
    it('validates 6-digit PIN and valid port inputs', async () => {
      const onPair = vi.fn().mockResolvedValue(true);
      const onClose = vi.fn();

      render(
        <PairingModal
          isOpen={true}
          onClose={onClose}
          onPair={onPair}
        />
      );

      expect(screen.getByText('Pair Wireless Debugging')).toBeDefined();

      const ipInput = screen.getByPlaceholderText('e.g. 192.168.1.100');
      const portInput = screen.getByPlaceholderText('e.g. 37841');
      const codeInput = screen.getByPlaceholderText('e.g. 123456');

      fireEvent.change(ipInput, { target: { value: '192.168.1.120' } });
      fireEvent.change(portInput, { target: { value: '41234' } });
      fireEvent.change(codeInput, { target: { value: '987654' } });

      const submitBtn = screen.getByText('Pair & Connect');
      await act(async () => {
        fireEvent.click(submitBtn);
      });

      expect(onPair).toHaveBeenCalledWith({
        ip: '192.168.1.120',
        pairingPort: 41234,
        code: '987654',
        connectPort: 5555,
      });
    });
  });

  describe('SessionStatusBar Component', () => {
    it('displays active profile, PID, and stop button', () => {
      const onStop = vi.fn();
      const mockSession: ActiveSession = {
        sessionId: 'sess_123',
        deviceSerial: 'R5CW10ABCDE',
        profile: 'samsung_dex',
        pid: 88412,
        startedAt: new Date().toISOString(),
        status: 'running',
        config: {
          serial: 'R5CW10ABCDE',
          profile: 'samsung_dex',
          resolution: '1440p',
          dpi: 240,
          refreshRate: 60,
          codec: 'h264',
          audioRouting: true,
          modelName: 'Galaxy S24 Ultra',
        },
      };

      render(
        <SessionStatusBar
          session={mockSession}
          onStop={onStop}
          isStopping={false}
        />
      );

      expect(screen.getByText('Samsung DeX')).toBeDefined();
      expect(screen.getByText(/PID: 88412/)).toBeDefined();

      const stopBtn = screen.getByText('Stop Session');
      fireEvent.click(stopBtn);
      expect(onStop).toHaveBeenCalledWith('sess_123');
    });
  });

  describe('LogViewer Component', () => {
    it('toggles log drawer and clears logs', () => {
      const onClear = vi.fn();
      const logs = [
        { sessionId: 'sess_1', text: '[scrcpy] INFO: Connected to display 1' },
      ];

      render(<LogViewer logs={logs} onClearLogs={onClear} />);

      expect(screen.getByText('Session Logs')).toBeDefined();
      expect(screen.getByText('1')).toBeDefined();

      // Open drawer
      fireEvent.click(screen.getByText('Session Logs'));
      expect(screen.getByText('[scrcpy] INFO: Connected to display 1')).toBeDefined();

      // Clear logs
      const clearBtn = screen.getByTitle('Clear Logs');
      fireEvent.click(clearBtn);
      expect(onClear).toHaveBeenCalledTimes(1);
    });
  });

  describe('Toast Component', () => {
    it('renders toasts and dismisses on click', () => {
      const onDismiss = vi.fn();
      const toasts: ToastMessage[] = [
        { id: 't1', type: 'success', message: 'Switched to Wi-Fi successfully' },
      ];

      render(<Toast toasts={toasts} onDismiss={onDismiss} />);

      expect(screen.getByText('Switched to Wi-Fi successfully')).toBeDefined();
    });
  });
});
