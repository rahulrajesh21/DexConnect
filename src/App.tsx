import { useEffect, useState, useCallback } from 'react';
import { Smartphone, RefreshCw } from 'lucide-react';
import type {
  DeviceInfo,
  SystemStatus,
  LaunchProfile,
  ResolutionPreset,
  VideoCodec,
  RefreshRate,
  ActiveSession,
  SessionLogEntry,
  RecentWirelessDevice,
  PairWirelessPayload,
} from './types';
import { Titlebar } from './components/Titlebar';
import { DeviceCard } from './components/DeviceCard';
import { RecentDevicesList } from './components/RecentDevicesList';
import { LaunchCard, PROFILES } from './components/LaunchCard';
import { QuickControls } from './components/QuickControls';
import { PairingModal } from './components/PairingModal';
import { SessionStatusBar } from './components/SessionStatusBar';
import { LogViewer } from './components/LogViewer';
import { Toast, type ToastMessage } from './components/Toast';

export default function App() {
  // Device & System state
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [selectedSerial, setSelectedSerial] = useState<string | null>(null);
  const [recentDevices, setRecentDevices] = useState<RecentWirelessDevice[]>([]);

  // Session configuration state
  const [selectedProfile, setSelectedProfile] = useState<LaunchProfile>('samsung_dex');
  const [resolution, setResolution] = useState<ResolutionPreset>('1440p');
  const [dpi, setDpi] = useState<number>(240);
  const [fps, setFps] = useState<RefreshRate>(60);
  const [codec, setCodec] = useState<VideoCodec>('h264');
  const [audioRouting, setAudioRouting] = useState<boolean>(true);

  // Active session and logs
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [logs, setLogs] = useState<SessionLogEntry[]>([]);

  // UI operation states
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isLaunching, setIsLaunching] = useState<boolean>(false);
  const [isStopping, setIsStopping] = useState<boolean>(false);
  const [migratingSerial, setMigratingSerial] = useState<string | null>(null);
  const [connectingAddress, setConnectingAddress] = useState<string | null>(null);
  const [isPairingModalOpen, setIsPairingModalOpen] = useState<boolean>(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Helper to add toast
  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = `${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Auto-tune profile to matched device brand
  const handleDeviceSelect = useCallback((serial: string, devsList: DeviceInfo[] = devices) => {
    setSelectedSerial(serial);
    const dev = devsList.find((d) => d.serial === serial);
    if (dev) {
      if (dev.brand === 'samsung') {
        setSelectedProfile('samsung_dex');
      } else if (dev.brand === 'motorola') {
        setSelectedProfile('motorola_ready_for');
      } else {
        setSelectedProfile('universal_desktop');
      }
    }
  }, [devices]);

  // Initial data loading and IPC subscriptions
  useEffect(() => {
    const api = window.dexconnect;
    if (!api) return;

    // Load System status
    api.getSystemStatus().then(setSystemStatus).catch(console.error);

    // Load Recent devices
    api.getRecentWirelessDevices().then(setRecentDevices).catch(console.error);

    // Load Active sessions
    api.getActiveSessions().then((sessions) => {
      const running = sessions.find((s) => s.status === 'running' || s.status === 'starting');
      if (running) setActiveSession(running);
    }).catch(console.error);

    // Initial Devices fetch
    api.getDevices().then((devs) => {
      setDevices(devs);
      if (devs.length > 0 && !selectedSerial) {
        handleDeviceSelect(devs[0].serial, devs);
      }
    }).catch(console.error);

    // Subscriptions
    const unsubDevices = api.onDevicesUpdated((updatedDevices) => {
      setDevices(updatedDevices);
      if (updatedDevices.length > 0) {
        if (!selectedSerial || !updatedDevices.some((d) => d.serial === selectedSerial)) {
          handleDeviceSelect(updatedDevices[0].serial, updatedDevices);
        }
      } else {
        setSelectedSerial(null);
      }
      // Also refresh recent devices
      api.getRecentWirelessDevices().then(setRecentDevices).catch(console.error);
    });

    const unsubSession = api.onSessionStatusChanged((session) => {
      if (session.status === 'running' || session.status === 'starting') {
        setActiveSession(session);
      } else {
        setActiveSession(null);
      }
    });

    const unsubLogs = api.onSessionLog((entry) => {
      setLogs((prev) => [...prev.slice(-300), entry]);
    });

    return () => {
      unsubDevices();
      unsubSession();
      unsubLogs();
    };
  }, [handleDeviceSelect, selectedSerial]);

  // Refresh devices
  const handleRefreshDevices = async () => {
    if (!window.dexconnect) return;
    setIsRefreshing(true);
    try {
      const devs = await window.dexconnect.getDevices();
      setDevices(devs);
      const recents = await window.dexconnect.getRecentWirelessDevices();
      setRecentDevices(recents);
      showToast(`Detected ${devs.length} device(s)`, 'info');
    } catch {
      showToast('Failed to query ADB devices', 'error');
    } finally {
      setIsRefreshing(false);
    }
  };

  // Launch Session
  const handleLaunchSession = async () => {
    if (!window.dexconnect || !selectedSerial) return;
    const selectedDev = devices.find((d) => d.serial === selectedSerial);

    setIsLaunching(true);
    try {
      const result = await window.dexconnect.launchSession({
        serial: selectedSerial,
        profile: selectedProfile,
        resolution,
        dpi,
        refreshRate: fps,
        codec,
        audioRouting,
        modelName: selectedDev?.model || selectedSerial,
      });

      if (result.success) {
        showToast(`Desktop session started (Session ID: ${result.sessionId})`, 'success');
      } else {
        showToast(result.error || 'Failed to start session', 'error');
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Error launching session', 'error');
    } finally {
      setIsLaunching(false);
    }
  };

  // Stop Session
  const handleStopSession = async (sessionId: string) => {
    if (!window.dexconnect) return;
    setIsStopping(true);
    try {
      const result = await window.dexconnect.stopSession(sessionId);
      if (result.success) {
        showToast('Session terminated cleanly', 'info');
        setActiveSession(null);
      } else {
        showToast(result.error || 'Failed to stop session', 'error');
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Error stopping session', 'error');
    } finally {
      setIsStopping(false);
    }
  };

  // Migrate USB to Wireless
  const handleMigrateToWifi = async (serial: string) => {
    if (!window.dexconnect) return;
    setMigratingSerial(serial);
    try {
      const result = await window.dexconnect.migrateToWireless(serial);
      if (result.success) {
        showToast(`Switched to Wi-Fi at ${result.ip}:5555! You can unplug the USB cable.`, 'success');
        const devs = await window.dexconnect.getDevices();
        setDevices(devs);
        const recents = await window.dexconnect.getRecentWirelessDevices();
        setRecentDevices(recents);
      } else {
        showToast(result.error || 'Migration failed. Ensure Wi-Fi is active on the phone.', 'error');
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Migration error', 'error');
    } finally {
      setMigratingSerial(null);
    }
  };

  // Connect Recent Wireless device
  const handleConnectRecent = async (address: string) => {
    if (!window.dexconnect) return;
    setConnectingAddress(address);
    try {
      const result = await window.dexconnect.connectWirelessDevice(address);
      if (result.success) {
        showToast(`Connected wirelessly to ${address}`, 'success');
        const devs = await window.dexconnect.getDevices();
        setDevices(devs);
      } else {
        showToast(result.error || `Could not reach ${address}`, 'error');
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Connection error', 'error');
    } finally {
      setConnectingAddress(null);
    }
  };

  // Pair Wireless Device
  const handlePairWireless = async (payload: PairWirelessPayload): Promise<boolean> => {
    if (!window.dexconnect) return false;
    const result = await window.dexconnect.pairWirelessDevice(payload);
    if (result.success) {
      showToast(`Paired & connected to ${payload.ip}!`, 'success');
      const devs = await window.dexconnect.getDevices();
      setDevices(devs);
      const recents = await window.dexconnect.getRecentWirelessDevices();
      setRecentDevices(recents);
      return true;
    } else {
      throw new Error(result.error || 'Pairing rejected by device');
    }
  };

  const selectedProfileDef = PROFILES.find((p) => p.id === selectedProfile) || PROFILES[0];
  const selectedDevice = devices.find((d) => d.serial === selectedSerial);

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0A0E17] text-gray-200 select-none overflow-hidden font-sans">
      {/* Toast Notifications */}
      <Toast toasts={toasts} onDismiss={dismissToast} />

      {/* Titlebar */}
      <Titlebar
        systemStatus={systemStatus}
        onRefreshDevices={handleRefreshDevices}
        onOpenPairingModal={() => setIsPairingModalOpen(true)}
        isRefreshing={isRefreshing}
      />

      {/* Main Layout Area */}
      <div className="flex-1 flex overflow-hidden p-4 space-x-4">
        {/* Left Column: Device Manager & Recent Devices */}
        <aside className="w-80 flex flex-col space-y-3 shrink-0">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold tracking-wider text-gray-400 uppercase">
              Connected Devices ({devices.length})
            </h2>
            <button
              type="button"
              onClick={handleRefreshDevices}
              className={`p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-all ${
                isRefreshing ? 'animate-spin' : ''
              }`}
              title="Refresh Devices"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Device Cards List */}
          <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
            {devices.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-center rounded-2xl border border-white/5 bg-white/[0.02]">
                <Smartphone className="w-10 h-10 text-gray-600 mb-2.5 stroke-[1.5]" />
                <p className="text-sm text-gray-300 font-medium">No Devices Detected</p>
                <p className="text-xs text-gray-500 mt-1 max-w-[200px]">
                  Connect via USB cable or click <strong>Pair Wireless</strong> above.
                </p>
              </div>
            ) : (
              devices.map((device) => (
                <DeviceCard
                  key={device.serial}
                  device={device}
                  isSelected={selectedSerial === device.serial}
                  onSelect={(serial) => handleDeviceSelect(serial)}
                  onMigrateToWifi={handleMigrateToWifi}
                  isMigrating={migratingSerial === device.serial}
                />
              ))
            )}

            {/* Recent Paired Wireless Devices */}
            <RecentDevicesList
              recentDevices={recentDevices}
              onConnect={handleConnectRecent}
              connectingAddress={connectingAddress}
            />
          </div>
        </aside>

        {/* Right Column: Active Session, Profiles & Quick Controls */}
        <main className="flex-1 flex flex-col space-y-4 overflow-y-auto pr-1">
          {/* Active Session Status Bar (if any session is running) */}
          {activeSession && (
            <SessionStatusBar
              session={activeSession}
              onStop={handleStopSession}
              isStopping={isStopping}
            />
          )}

          {/* Launch Profiles Selection */}
          <section>
            <div className="flex items-center justify-between mb-2.5">
              <h2 className="text-xs font-semibold tracking-wider text-gray-400 uppercase">
                Launch Profiles
              </h2>
              {selectedDevice && (
                <span className="text-xs text-blue-400 font-medium">
                  Optimized for {selectedDevice.model}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              {PROFILES.map((profile) => (
                <LaunchCard
                  key={profile.id}
                  profile={profile}
                  isSelected={selectedProfile === profile.id}
                  onSelect={(id) => setSelectedProfile(id)}
                />
              ))}
            </div>
          </section>

          {/* Quick Controls & Launch Action */}
          <section className="flex-1">
            <QuickControls
              resolution={resolution}
              setResolution={setResolution}
              dpi={dpi}
              setDpi={setDpi}
              fps={fps}
              setFps={setFps}
              codec={codec}
              setCodec={setCodec}
              audioRouting={audioRouting}
              setAudioRouting={setAudioRouting}
              onLaunch={handleLaunchSession}
              isLaunching={isLaunching}
              hasSelectedDevice={!!selectedSerial}
              selectedProfileName={selectedProfileDef.title}
            />
          </section>
        </main>
      </div>

      {/* Collapsible Session Log Viewer */}
      <LogViewer logs={logs} onClearLogs={() => setLogs([])} />

      {/* Android 11+ Wireless Debugging Pairing Modal */}
      <PairingModal
        isOpen={isPairingModalOpen}
        onClose={() => setIsPairingModalOpen(false)}
        onPair={handlePairWireless}
      />
    </div>
  );
}
