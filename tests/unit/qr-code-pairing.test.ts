import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  WirelessWizard,
  generateQrPairingPayload,
  parseMdnsServicesOutput,
} from '../../electron/main/services/WirelessWizard';
import { MockAdbExecutor } from '../../electron/main/adapters/MockAdbExecutor';
import type { QrPairingProgress } from '../../src/types';

describe('Wireless QR Code Pairing Engine', () => {
  let mockAdb: MockAdbExecutor;
  let wizard: WirelessWizard;

  beforeEach(() => {
    mockAdb = new MockAdbExecutor();
    wizard = new WirelessWizard(mockAdb);
  });

  afterEach(() => {
    wizard.dispose();
  });

  describe('generateQrPairingPayload', () => {
    it('generates an AOSP-compliant WIFI:T:ADB pairing string', () => {
      const { serviceName, password, payload } = generateQrPairingPayload();

      expect(serviceName).toMatch(/^ADB_WIFI_[A-Za-z0-9]+-[A-Za-z0-9]+$/);
      expect(password).toHaveLength(20);
      expect(payload).toBe(`WIFI:T:ADB;S:${serviceName};P:${password};;`);
    });

    it('respects custom serviceName and password parameters', () => {
      const customName = 'ADB_WIFI_dexconnect-mac';
      const customPwd = 'SecretP@ssword1234567';
      const { serviceName, password, payload } = generateQrPairingPayload(customName, customPwd);

      expect(serviceName).toBe(customName);
      expect(password).toBe(customPwd);
      expect(payload).toBe(`WIFI:T:ADB;S:${customName};P:${customPwd};;`);
    });

    it('produces high entropy non-colliding credentials across invocations', () => {
      const set = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const { payload } = generateQrPairingPayload();
        set.add(payload);
      }
      expect(set.size).toBe(50);
    });
  });

  describe('parseMdnsServicesOutput', () => {
    it('parses pairing and connect records from standard adb mdns output', () => {
      const sample = `
List of discovered mdns services
adb-mock-dev._adb-tls-pairing._tcp.    _adb-tls-pairing._tcp.    192.168.1.185:39241
adb-mock-dev._adb-tls-connect._tcp.    _adb-tls-connect._tcp.    192.168.1.185:41889
`;
      const result = parseMdnsServicesOutput(sample);
      expect(result).toHaveLength(2);

      const pairing = result.find((r) => r.type === 'pairing');
      expect(pairing).toBeDefined();
      expect(pairing?.ip).toBe('192.168.1.185');
      expect(pairing?.port).toBe(39241);

      const connect = result.find((r) => r.type === 'connect');
      expect(connect).toBeDefined();
      expect(connect?.ip).toBe('192.168.1.185');
      expect(connect?.port).toBe(41889);
    });

    it('returns empty array on empty or irrelevant mdns services', () => {
      expect(parseMdnsServicesOutput('')).toEqual([]);
      expect(parseMdnsServicesOutput('List of discovered mdns services')).toEqual([]);
      expect(parseMdnsServicesOutput('random-service._http._tcp. 192.168.1.1:80')).toEqual([]);
    });
  });

  describe('WirelessWizard.startQrPairing Lifecycle', () => {
    it('initializes QR pairing session with base64 PNG data URL', async () => {
      const session = await wizard.startQrPairing({
        timeoutMs: 5000,
        pollIntervalMs: 50,
      });

      expect(session.sessionId).toMatch(/^qr-/);
      expect(session.serviceName).toContain('ADB_WIFI_');
      expect(session.password).toHaveLength(20);
      expect(session.qrPayload).toBe(`WIFI:T:ADB;S:${session.serviceName};P:${session.password};;`);
      expect(session.qrDataUrl).toMatch(/^data:image\/png;base64,/);
      expect(session.expiresAt).toBeGreaterThan(Date.now());
    });

    it('discovers device over mDNS, executes pair & connect, and registers recent device', async () => {
      const progressEvents: QrPairingProgress[] = [];
      wizard.on('qr-pairing-progress', (p: QrPairingProgress) => {
        progressEvents.push(p);
      });

      // Start QR session with fast polling
      const session = await wizard.startQrPairing({
        timeoutMs: 5000,
        pollIntervalMs: 25,
      });

      expect(progressEvents[0]?.state).toBe('waiting_for_scan');

      // Simulate phone camera scan: device appears on mDNS
      mockAdb.simulateMdnsPairingDevice('192.168.1.155', 38921, 5555, session.serviceName);

      // Wait for poll interval to detect and complete handshake
      await new Promise((resolve) => {
        wizard.on('qr-pairing-progress', (p: QrPairingProgress) => {
          if (p.state === 'completed' || p.state === 'error') {
            resolve(p);
          }
        });
      });

      const states = progressEvents.map((p) => p.state);
      expect(states).toContain('waiting_for_scan');
      expect(states).toContain('device_spotted');
      expect(states).toContain('pairing');
      expect(states).toContain('connecting');
      expect(states).toContain('completed');

      const completedEvent = progressEvents.find((p) => p.state === 'completed');
      expect(completedEvent).toBeDefined();
      expect(completedEvent?.ip).toBe('192.168.1.155');
      expect(completedEvent?.connectPort).toBe(5555);

      // Verify device was persisted to Recent Store
      const recents = wizard.getRecentDevices();
      expect(recents.some((d) => d.ip === '192.168.1.155')).toBe(true);
    });

    it('supports cancellation via stopQrPairing', async () => {
      const progressEvents: QrPairingProgress[] = [];
      wizard.on('qr-pairing-progress', (p: QrPairingProgress) => {
        progressEvents.push(p);
      });

      const session = await wizard.startQrPairing({
        timeoutMs: 5000,
        pollIntervalMs: 50,
      });

      wizard.stopQrPairing(session.sessionId);

      expect(progressEvents.some((p) => p.state === 'cancelled')).toBe(true);
      expect(wizard.getActiveQrSession()).toBeNull();
    });

    it('handles session timeout when no device is detected', async () => {
      const progressEvents: QrPairingProgress[] = [];
      wizard.on('qr-pairing-progress', (p: QrPairingProgress) => {
        progressEvents.push(p);
      });

      await wizard.startQrPairing({
        timeoutMs: 80,
        pollIntervalMs: 20,
      });

      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(progressEvents.some((p) => p.state === 'timeout')).toBe(true);
      expect(wizard.getActiveQrSession()).toBeNull();
    });
  });
});
