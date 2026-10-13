# Project: DexConnect for Mac

## Architecture
DexConnect for Mac is a native-feeling macOS desktop application built with Electron, Vite, React, TypeScript, and Tailwind CSS. It is engineered with a Clean Architecture boundary:
- **Electron Main Process**:
  - `DeviceManager`: Supervises ADB devices via polling, caches properties (`ro.product.manufacturer`, `ro.product.model`, `ro.build.version.release`, `dumpsys battery`), and streams diffs to renderer.
  - `SessionLauncher`: Builds optimized arguments for Scrcpy sessions, spawns/supervises child processes (PIDs, exit codes, ring-buffer logs), and provides clean termination.
  - `WirelessWizard`: Coordinates 1-click USB-to-Wi-Fi migration (`adb tcpip 5555`, `adb connect`) and Android 11+ pairing (`adb pair`, `adb connect`).
  - Pluggable Adapters: `IAdbExecutor` (`SystemAdbExecutor` / `MockAdbExecutor`) and `IScrcpyProcessRunner` (`SystemScrcpyRunner` / `MockScrcpyRunner`). Supports `DEXCONNECT_MOCK=1` for deterministic CI testability.
- **Preload Script**:
  - Context-isolated `window.dexconnect` API surface using `contextBridge` and typed IPC channels.
- **Renderer Process**:
  - React 18/19 + Vite + Tailwind CSS styled with a macOS dark glassmorphic theme (`#0B0F17`, frosted glass panels, glowing accent rings).
  - Component hierarchy: `Titlebar`, `DeviceSection` (`DeviceCard` with brand logo, battery, connection type), `LaunchProfilesSection` (Samsung DeX, Motorola Smart Connect / Ready For, Universal Android Desktop, Low-Latency Mirror), `QuickControlsBar` (dock with Resolution, DPI, FPS, Codec, Audio), `WirelessPairingModal`, `SessionStatusBar`, and `LogViewerDrawer`.

---

## Feature Inventory
Every feature from user requirements and survey discovery is cataloged and assigned to a milestone:

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Toolchain & Scrcpy Setup | Verify Node, npm, scrcpy v5.0.1 via Homebrew, build scripts (`npm run build`, `npm run dev`) | M1 | ORIGINAL_REQUEST §Build, Survey 1 |
| 2 | Clean Architecture DI Adapters | `IAdbExecutor` & `IScrcpyProcessRunner` with System & Mock implementations | M1 | Survey 3 |
| 3 | Project Scaffolding & Build | Electron + Vite + React + TS + Tailwind with strict typing and zero TS errors | M1 | ORIGINAL_REQUEST §R1 |
| 4 | IPC Boundary & Type Contracts | Typed IPC channels, contextBridge exposure, memory-leak-safe event listeners | M1 | Survey 3 |
| 5 | ADB Device Polling & Diffing | Supervise `adb devices -l`, detect connect/disconnect within 3 seconds | M2 | ORIGINAL_REQUEST §R2 |
| 6 | Device Manufacturer Identification | Query `ro.product.manufacturer` to identify Samsung vs Motorola vs Generic | M2 | ORIGINAL_REQUEST §R2 |
| 7 | Device Model & OS Extraction | Query `ro.product.model` and `ro.build.version.release` | M2 | ORIGINAL_REQUEST §R2 |
| 8 | Battery Supervision & Parsing | Query and parse `dumpsys battery` (level %, charging status, power source) | M2 | ORIGINAL_REQUEST §R2 |
| 9 | Connection Type Detection | Identify USB (`USB 🟢`) vs Wi-Fi (`Wi-Fi 📶`) via serial format and transport | M2 | ORIGINAL_REQUEST §R1, §R2 |
| 10 | Live Device Stream over IPC | Stream `devices:changed` updates to renderer process | M2 | ORIGINAL_REQUEST §R2 |
| 11 | Samsung DeX Profile Launcher | Optimized scrcpy args (`--new-display=WxH/DPI`, `--stay-awake`, `--audio-source=playback`, `--keyboard=uhid`, `--mouse=uhid`) | M3 | ORIGINAL_REQUEST §R3, Survey 2 |
| 12 | Motorola Smart Connect Profile | Tailored scrcpy args (`--new-display`, `--turn-screen-off`, `--stay-awake`, `--keyboard=uhid`, `--mouse=uhid`) | M3 | ORIGINAL_REQUEST §R3, Survey 2 |
| 13 | Universal Android Desktop Profile | Virtual display desktop mode with freeform windowing support | M3 | ORIGINAL_REQUEST §R1, Survey 2 |
| 14 | Low-Latency Screen Mirror Profile | Primary screen mirror with `--turn-screen-off`, zero buffer, low-latency audio | M3 | ORIGINAL_REQUEST §R1, §R3 |
| 15 | Quick Controls Resolution/DPI Builder | Map 1080p, 1440p, 4K, 16:10 Retina and 160-320 DPI into `--new-display=WxH/DPI` | M3 | ORIGINAL_REQUEST §R1, Survey 2 |
| 16 | Quick Controls FPS, Codec & Audio | Map 60/90/120 FPS, H.264/H.265 codec, and audio playback vs mute | M3 | ORIGINAL_REQUEST §R1, Survey 2 |
| 17 | Session PID Supervision & Teardown | Track active session PIDs, exit code monitoring (0, 1, 2), clean stop/restart | M3 | ORIGINAL_REQUEST §R3 |
| 18 | Session Log Streaming | Ring-buffer log capture (stdout/stderr) and streaming to UI | M3 | ORIGINAL_REQUEST §R3 |
| 19 | 1-Click USB-to-Wi-Fi Migration | Query phone IP, run `adb tcpip 5555`, connect wirelessly (`adb connect <ip>:5555`) | M4 | ORIGINAL_REQUEST §R4 |
| 20 | Android 11+ Wireless Debugging Pairing | Modal execution of `adb pair <ip>:<port> <code>` followed by `adb connect` | M4 | ORIGINAL_REQUEST §R4 |
| 21 | Paired Device History & Reconnect | Remember recent wireless devices for 1-click reconnection | M4 | ORIGINAL_REQUEST §R4 |
| 22 | macOS Glassmorphic Dark UI Theme | Dark glassmorphism (`#0B0F17`, frosted glass, glow rings, traffic lights) | M5 | ORIGINAL_REQUEST §R1 |
| 23 | Device Cards & Brand Badges UI | Display brand logos (Samsung, Motorola, Android), model, battery, connection type | M5 | ORIGINAL_REQUEST §R1 |
| 24 | 1-Click Launch Cards UI | Interactive cards for DeX, Smart Connect, Universal Desktop, Screen Mirror | M5 | ORIGINAL_REQUEST §R1 |
| 25 | Quick Controls Dock UI | Floating glass bar for resolution, DPI slider, FPS, codec, audio toggle | M5 | ORIGINAL_REQUEST §R1 |
| 26 | Wireless Migration & Pairing Modal UI | Modal sheet with tabs for 1-Click USB switch, Android 11+ pairing, and saved devices | M5 | ORIGINAL_REQUEST §R4 |
| 27 | Active Session Status Bar & Drawer UI | Status bar showing running session, duration, PID, stop button, and log drawer | M5 | ORIGINAL_REQUEST §R1, §R3 |
| 28 | Comprehensive E2E Test Suite (Tiers 1-4) | 100% pass of requirement-driven opaque-box E2E test suite | M6 | ORIGINAL_REQUEST §Acceptance |
| 29 | Adversarial Coverage Hardening (Tier 5) | White-box adversarial testing, edge case resilience, process cleanup validation | M6 | Project Pattern §Phase 2 |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Core Scaffolding, Toolchain & Adapters | Electron + Vite + React + TS + Tailwind setup, `IAdbExecutor`, `IScrcpyProcessRunner`, Mock/System adapters, IPC channels, build verification | none | DONE |
| M2 | Device Detection & Lifecycle Management | `DeviceManager` service, ADB polling, manufacturer detection, model/OS extraction, battery parsing, connection type, IPC streaming | M1 | DONE |
| M3 | Session Launcher & Scrcpy Manager | `SessionLauncher` service, profile arg builders (DeX, Ready For, Desktop, Mirror), PID supervisor, UHID/audio flags, log streamer, session IPC | M1 | DONE |
| M4 | Wireless Migration & Pairing Wizard | `WirelessWizard` service, USB-to-Wi-Fi switch (`adb tcpip 5555`), Android 11+ pairing (`adb pair`), device history store, IPC handlers | M1, M2 | PLANNED |
| M5 | macOS Glassmorphic UI Dashboard | React components: Titlebar, DeviceList/Cards, 4 Launch Cards, QuickControls dock, Pairing Modal, SessionStatusBar, LogViewer, IPC hooks integration | M1, M2, M3, M4 | PLANNED |
| M6 | Final Milestone: 100% E2E Pass & Adversarial Hardening | Phase 1: Pass 100% E2E Test Suite (Tiers 1-4 from TEST_READY.md). Phase 2: Tier 5 Adversarial Coverage Hardening | M1, M2, M3, M4, M5, E2E Track | PLANNED |

---

## Interface Contracts

### 1. `IAdbExecutor` & `DeviceManager`
```typescript
export interface DeviceRawRecord {
  serial: string;
  state: 'device' | 'unauthorized' | 'offline' | 'unknown';
  product?: string;
  model?: string;
  device?: string;
  transportId?: string;
}

export interface BatteryInfo {
  level: number;
  scale: number;
  status: number;
  isCharging: boolean;
  powerSource: 'ac' | 'usb' | 'wireless' | 'battery';
}

export interface DeviceInfo {
  serial: string;
  state: 'device' | 'unauthorized' | 'offline';
  brand: 'samsung' | 'motorola' | 'generic';
  manufacturer: string;
  model: string;
  androidVersion: string;
  connectionType: 'usb' | 'wifi';
  ipAddress?: string;
  port?: number;
  battery: BatteryInfo;
}

export interface IAdbExecutor {
  getDevices(): Promise<DeviceRawRecord[]>;
  getProp(serial: string, prop: string): Promise<string>;
  getBatteryInfo(serial: string): Promise<BatteryInfo>;
  getDeviceIp(serial: string): Promise<string | null>;
  switchTcpip(serial: string, port: number): Promise<{ success: boolean; output: string }>;
  connect(address: string): Promise<{ success: boolean; output: string }>;
  disconnect(address?: string): Promise<{ success: boolean; output: string }>;
  pair(addressWithPort: string, code: string): Promise<{ success: boolean; output: string }>;
  checkAdbInstalled(): Promise<{ installed: boolean; path: string; version?: string }>;
}
```

### 2. `IScrcpyProcessRunner` & `SessionLauncher`
```typescript
export type LaunchProfile = 'samsung_dex' | 'motorola_ready_for' | 'universal_desktop' | 'screen_mirror';
export type ResolutionPreset = '1080p' | '1440p' | '4k' | 'retina_16_10';
export type VideoCodec = 'h264' | 'h265';
export type RefreshRate = 60 | 90 | 120;

export interface LaunchConfig {
  serial: string;
  profile: LaunchProfile;
  resolution: ResolutionPreset;
  dpi: number; // 160-320
  refreshRate: RefreshRate;
  codec: VideoCodec;
  audioRouting: boolean;
  modelName: string;
}

export interface ActiveSession {
  sessionId: string;
  deviceSerial: string;
  profile: LaunchProfile;
  pid: number;
  startedAt: string;
  config: LaunchConfig;
  status: 'starting' | 'running' | 'stopping' | 'terminated' | 'error';
  exitCode?: number;
  error?: string;
}

export interface IChildProcessHandle extends NodeJS.EventEmitter {
  pid: number;
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface IScrcpyProcessRunner {
  checkScrcpyInstalled(): Promise<{ installed: boolean; path: string; version?: string }>;
  spawnSession(args: string[], options?: { env?: NodeJS.ProcessEnv }): Promise<IChildProcessHandle>;
  killProcess(pid: number, signal?: NodeJS.Signals): Promise<boolean>;
  getLastSpawnedArgs?(): string[];
}
```

### 3. Preload IPC Contract (`window.dexconnect`)
```typescript
export interface IDexConnectAPI {
  getDevices: () => Promise<DeviceInfo[]>;
  getSystemStatus: () => Promise<{ adb: boolean; scrcpy: boolean; scrcpyVersion?: string }>;
  launchSession: (config: LaunchConfig) => Promise<{ success: boolean; sessionId?: string; error?: string }>;
  stopSession: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
  getActiveSessions: () => Promise<ActiveSession[]>;
  migrateToWireless: (serial: string) => Promise<{ success: boolean; ip?: string; error?: string }>;
  pairWirelessDevice: (payload: { ip: string; pairingPort: number; code: string; connectPort: number }) => Promise<{ success: boolean; error?: string }>;
  connectWirelessDevice: (address: string) => Promise<{ success: boolean; error?: string }>;
  getRecentWirelessDevices: () => Promise<{ ip: string; port: number; model: string; lastSeen: number }[]>;
  onDevicesUpdated: (callback: (devices: DeviceInfo[]) => void) => () => void;
  onSessionStatusChanged: (callback: (session: ActiveSession) => void) => () => void;
  onSessionLog: (callback: (log: { sessionId: string; text: string }) => void) => () => void;
}
```

---

## Code Layout
```
/Users/rahul/Connect/
├── electron/
│   ├── main/
│   │   ├── index.ts                     # Main entry point & window manager
│   │   ├── factory.ts                   # Dependency injection factory
│   │   ├── services/
│   │   │   ├── DeviceManager.ts         # ADB device supervision & property caching
│   │   │   ├── SessionLauncher.ts       # Scrcpy process supervisor & arg builder
│   │   │   └── WirelessWizard.ts        # Wi-Fi migration & pairing workflows
│   │   ├── adapters/
│   │   │   ├── IAdbExecutor.ts          # ADB abstraction interface
│   │   │   ├── SystemAdbExecutor.ts     # Real /opt/homebrew/bin/adb CLI runner
│   │   │   ├── MockAdbExecutor.ts       # Deterministic mock ADB state machine
│   │   │   ├── IScrcpyProcessRunner.ts  # Scrcpy process abstraction interface
│   │   │   ├── SystemScrcpyRunner.ts    # Real child_process spawner
│   │   │   └── MockScrcpyRunner.ts      # Deterministic process & stream simulator
│   │   └── ipc/
│   │       ├── channels.ts              # Strongly typed IPC channel constants
│   │       └── handlers.ts              # ipcMain.handle registrations
│   └── preload/
│       ├── index.ts                     # contextBridge exposure
│       └── api.ts                       # Typed bridge implementation
├── src/                                 # React + Vite + Tailwind Renderer
│   ├── main.tsx                         # React entrypoint
│   ├── App.tsx                          # Root container with dark theme shell
│   ├── index.css                        # Tailwind CSS base & glassmorphic utilities
│   ├── types/
│   │   ├── dexconnect.d.ts              # window.dexconnect type declarations
│   │   └── index.ts                     # Common data models
│   ├── components/
│   │   ├── Titlebar.tsx                 # macOS traffic light inset header
│   │   ├── DeviceSection.tsx            # Device list container & refresh action
│   │   ├── DeviceCard.tsx               # Brand logo, battery, connection type
│   │   ├── LaunchProfilesSection.tsx    # 4 Profile cards grid
│   │   ├── LaunchProfileCard.tsx        # DeX, Ready For, Desktop, Mirror card
│   │   ├── QuickControlsBar.tsx         # Resolution, DPI, FPS, Codec, Audio controls dock
│   │   ├── SessionStatusBar.tsx         # Running sessions indicator & stop button
│   │   ├── WirelessPairingModal.tsx     # USB switch & Android 11+ pairing modal
│   │   └── LogViewerDrawer.tsx          # Collapsible streaming terminal log drawer
│   └── hooks/
│       ├── useDevices.ts                # Live device subscription hook
│       ├── useActiveSession.ts          # Session management & log subscription hook
│       └── useLaunchConfig.ts           # Resolution, DPI, FPS, codec configuration state
├── tests/
│   ├── e2e/
│   │   ├── tier1_features/              # Tier 1 Feature coverage tests
│   │   ├── tier2_boundaries/            # Tier 2 Boundary & error case tests
│   │   ├── tier3_combinations/          # Tier 3 Pairwise cross-feature tests
│   │   └── tier4_application/           # Tier 4 Real-world user scenario tests
│   ├── fixtures/
│   │   └── mockDevices.ts               # Test fixtures and device profiles
│   └── setup.ts                         # Test runner setup
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── tailwind.config.js
├── PROJECT.md
└── TEST_INFRA.md
```
