import type { IDexConnectAPI } from './index';

declare global {
  interface Window {
    dexconnect: IDexConnectAPI;
  }
}

export {};
