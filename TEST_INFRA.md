# E2E Test Infra: DexConnect for Mac

## Test Philosophy
- **Requirement-Driven & Opaque-Box**: Tests verify the product purely against requirements defined in `ORIGINAL_REQUEST.md` and user-facing specifications. Tests exercise the application end-to-end through real user interactions, IPC boundaries, and process lifecycles.
- **Dual-Mode Execution**:
  - Mock CI Mode (`DEXCONNECT_MOCK=1`): Automated deterministic execution without requiring physical Android devices or real display servers.
  - Real Hardware Mode (`DEXCONNECT_MOCK=0`): Verifies live execution against `/opt/homebrew/bin/adb` and `/opt/homebrew/bin/scrcpy` when physical hardware is present.
- **Methodology**:
  - Tier 1: Category-Partition (≥5 test cases per core feature).
  - Tier 2: Boundary Value Analysis (BVA) & Corner/Error Cases (≥5 test cases per core feature).
  - Tier 3: Pairwise Combinatorial Testing (cross-feature interactions).
  - Tier 4: Real-World Workload Scenarios (realistic end-to-end user workflows).

---

## Core Feature Areas & Test Matrix

| # | Feature Area | Requirement Source | Tier 1 (Coverage) | Tier 2 (Boundaries) | Tier 3 (Cross-Feature) | Tier 4 (Workloads) |
|---|--------------|--------------------|:-----------------:|:-------------------:|:----------------------:|:------------------:|
| F1 | Build, Toolchain & Scrcpy Verification | ORIGINAL_REQUEST §Build, §R3 | 5 | 5 | ✓ | ✓ |
| F2 | Device Detection & Lifecycle Management | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ | ✓ |
| F3 | Device Properties & Battery Supervision | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ | ✓ |
| F4 | Session Launching & Profile Formulation | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| F5 | Quick Controls (Resolution, DPI, FPS, Audio) | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| F6 | Wireless Migration & Android 11+ Pairing | ORIGINAL_REQUEST §R4 | 5 | 5 | ✓ | ✓ |
| F7 | macOS Glassmorphic UI & Session Supervision | ORIGINAL_REQUEST §R1, §R3 | 5 | 5 | ✓ | ✓ |

---

## Test Architecture
- **Test Framework**: Vitest with Playwright / Electron test harness.
- **Test Suite Command**: `npm run test:e2e`
- **Unit Test Command**: `npm run test`
- **Typecheck Command**: `npm run typecheck`
- **Pass/Fail Semantics**: Zero test failures, exit code 0, zero unhandled rejections.
- **Directory Layout**:
  ```
  tests/
  ├── e2e/
  │   ├── tier1_features/
  │   │   ├── toolchain.test.ts          # F1: Toolchain, scrcpy version, npm build
  │   │   ├── device-detection.test.ts   # F2: USB/Wi-Fi auto-detection within 3s
  │   │   ├── device-properties.test.ts  # F3: Manufacturer, model, battery levels
  │   │   ├── launch-profiles.test.ts    # F4: DeX, Ready For, Desktop, Mirror args
  │   │   ├── quick-controls.test.ts     # F5: Resolution, DPI, FPS, Codec, Audio
  │   │   ├── wireless-wizard.test.ts    # F6: 1-click TCP/IP, pairing code validation
  │   │   └── ui-dashboard.test.ts       # F7: Glassmorphism elements, cards, status
  │   ├── tier2_boundaries/
  │   │   ├── disconnected-devices.test.ts # USB unplugged, offline devices, unauthorized
  │   │   ├── invalid-scrcpy-args.test.ts  # Invalid DPI, uninstalled scrcpy, crash recovery
  │   │   ├── battery-edge-cases.test.ts   # 0% battery, 100% battery, missing scale
  │   │   ├── pairing-failures.test.ts     # Wrong pairing code, timeout, wrong port
  │   │   └── adb-daemon-restart.test.ts   # Daemon restart lines filtering, socket refusal
  │   ├── tier3_combinations/
  │   │   ├── dex-controls-matrix.test.ts  # DeX + 4K + 320 DPI + 120 FPS + Audio
  │   │   ├── readyfor-codec-matrix.test.ts# Ready For + H.265 + 1440p + Screen Off
  │   │   ├── wireless-session-flow.test.ts# USB -> Wi-Fi switch -> Immediate DeX launch
  │   │   └── multi-device-switch.test.ts  # Samsung USB + Moto Wi-Fi simultaneous selection
  │   └── tier4_application/
  │       ├── scenario-dex-workstation.test.ts # Scenario 1: Pro Samsung DeX Workstation
  │       ├── scenario-moto-multitask.test.ts  # Scenario 2: Motorola Smart Connect Workflow
  │       ├── scenario-wireless-migrate.test.ts# Scenario 3: Complete Cordless Migration
  │       ├── scenario-screen-mirror.test.ts   # Scenario 4: Low-Latency Presentation Mirror
  │       └── scenario-fresh-pairing.test.ts   # Scenario 5: New Android 11+ Pairing Setup
  ├── fixtures/
  │   └── mockDevices.ts
  └── setup.ts
  ```

---

## Coverage Thresholds
- **Tier 1 (Feature Coverage)**: ≥ 35 test cases (5 per feature area across 7 areas).
- **Tier 2 (Boundary & Error Cases)**: ≥ 35 test cases (5 per feature area across 7 areas).
- **Tier 3 (Cross-Feature Combinations)**: ≥ 12 pairwise combinatorial test cases.
- **Tier 4 (Real-World Workloads)**: ≥ 5 comprehensive application scenario workflows.
- **Total Minimum Target**: ≥ 87 automated test cases with 100% passing status.
