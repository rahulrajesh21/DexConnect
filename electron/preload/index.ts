import { contextBridge } from 'electron';
import { dexconnectAPI } from './api';

// Expose the strongly typed, isolated API to the renderer under window.dexconnect
contextBridge.exposeInMainWorld('dexconnect', dexconnectAPI);
