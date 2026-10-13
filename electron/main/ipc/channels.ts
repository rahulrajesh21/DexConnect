/**
 * DexConnect IPC Channel Constants
 * Strongly typed channel identifiers shared between Electron Main and Preload.
 *
 * NOTE: This file must NOT import Electron or Node.js runtime modules
 * so it can be safely imported by Preload, Renderer, and Tests.
 */

export const DEXCONNECT_CHANNELS = {
  // Device Queries & Status
  GET_DEVICES: 'dexconnect:get-devices',
  GET_SYSTEM_STATUS: 'dexconnect:get-system-status',

  // Session Controls
  LAUNCH_SESSION: 'dexconnect:launch-session',
  STOP_SESSION: 'dexconnect:stop-session',
  GET_ACTIVE_SESSIONS: 'dexconnect:get-active-sessions',

  // Wireless Wizard & Pairing
  MIGRATE_WIRELESS: 'dexconnect:migrate-wireless',
  PAIR_WIRELESS_DEVICE: 'dexconnect:pair-wireless',
  PAIR_DEVICE: 'dexconnect:pair-wireless',
  CONNECT_WIRELESS_DEVICE: 'dexconnect:connect-wireless',
  CONNECT_WIRELESS: 'dexconnect:connect-wireless',
  DISCONNECT_WIRELESS: 'dexconnect:disconnect-wireless',
  DISCONNECT_WIRELESS_DEVICE: 'dexconnect:disconnect-wireless',
  GET_RECENT_WIRELESS_DEVICES: 'dexconnect:get-recent-wireless',
  GET_RECENT_DEVICES: 'dexconnect:get-recent-wireless',

  // Push Notifications (Main -> Renderer)
  DEVICES_UPDATED: 'dexconnect:devices-updated',
  SESSION_STATUS_CHANGED: 'dexconnect:session-status-changed',
  SESSION_LOG: 'dexconnect:session-log',
} as const;

// Individual exported constant names matching specification
export const DEXCONNECT_GET_DEVICES = DEXCONNECT_CHANNELS.GET_DEVICES;
export const DEXCONNECT_GET_SYSTEM_STATUS = DEXCONNECT_CHANNELS.GET_SYSTEM_STATUS;
export const DEXCONNECT_LAUNCH_SESSION = DEXCONNECT_CHANNELS.LAUNCH_SESSION;
export const DEXCONNECT_STOP_SESSION = DEXCONNECT_CHANNELS.STOP_SESSION;
export const DEXCONNECT_GET_ACTIVE_SESSIONS = DEXCONNECT_CHANNELS.GET_ACTIVE_SESSIONS;
export const DEXCONNECT_MIGRATE_WIRELESS = DEXCONNECT_CHANNELS.MIGRATE_WIRELESS;
export const DEXCONNECT_PAIR_WIRELESS_DEVICE = DEXCONNECT_CHANNELS.PAIR_WIRELESS_DEVICE;
export const DEXCONNECT_PAIR_DEVICE = DEXCONNECT_CHANNELS.PAIR_DEVICE;
export const DEXCONNECT_CONNECT_WIRELESS_DEVICE = DEXCONNECT_CHANNELS.CONNECT_WIRELESS_DEVICE;
export const DEXCONNECT_CONNECT_WIRELESS = DEXCONNECT_CHANNELS.CONNECT_WIRELESS;
export const DEXCONNECT_DISCONNECT_WIRELESS = DEXCONNECT_CHANNELS.DISCONNECT_WIRELESS;
export const DEXCONNECT_DISCONNECT_WIRELESS_DEVICE = DEXCONNECT_CHANNELS.DISCONNECT_WIRELESS_DEVICE;
export const DEXCONNECT_GET_RECENT_WIRELESS_DEVICES = DEXCONNECT_CHANNELS.GET_RECENT_WIRELESS_DEVICES;
export const DEXCONNECT_GET_RECENT_DEVICES = DEXCONNECT_CHANNELS.GET_RECENT_DEVICES;

export const DEXCONNECT_DEVICES_UPDATED = DEXCONNECT_CHANNELS.DEVICES_UPDATED;
export const DEXCONNECT_SESSION_STATUS_CHANGED = DEXCONNECT_CHANNELS.SESSION_STATUS_CHANGED;
export const DEXCONNECT_SESSION_LOG = DEXCONNECT_CHANNELS.SESSION_LOG;

export type DexConnectChannelName = typeof DEXCONNECT_CHANNELS[keyof typeof DEXCONNECT_CHANNELS];
