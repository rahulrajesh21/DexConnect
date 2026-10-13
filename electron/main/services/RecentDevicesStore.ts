import fs from 'node:fs';
import path from 'node:path';
import type { DeviceBrand } from '../../../src/types';

export interface RecentDevice {
  /** Unique composite identifier: `${ip}:${port}` */
  id: string;
  /** Full connection address: `${ip}:${port}` */
  address: string;
  /** Device IPv4 address */
  ip: string;
  /** Connection port (e.g. 5555, 42111) */
  port: number;
  /** Display model name or IP:Port fallback */
  name: string;
  /** Unix timestamp in milliseconds of most recent connection */
  lastConnected: number;
  /** Brand identity */
  brand: DeviceBrand;
  /** Backward-compatible model name alias matching RecentWirelessDevice */
  model: string;
  /** Backward-compatible timestamp alias matching RecentWirelessDevice */
  lastSeen: number;
}

export interface IRecentDevicesStorage {
  load(): Promise<RecentDevice[]> | RecentDevice[];
  save(devices: RecentDevice[]): Promise<void> | void;
}

export class InMemoryRecentDevicesStorage implements IRecentDevicesStorage {
  private items: RecentDevice[] = [];

  constructor(initialItems: RecentDevice[] = []) {
    this.items = [...initialItems];
  }

  public load(): RecentDevice[] {
    return [...this.items];
  }

  public save(devices: RecentDevice[]): void {
    this.items = [...devices];
  }
}

export class JsonFileRecentDevicesStorage implements IRecentDevicesStorage {
  constructor(private readonly filePath: string) {}

  public load(): RecentDevice[] {
    try {
      if (!fs.existsSync(this.filePath)) {
        return [];
      }
      const data = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  public save(devices: RecentDevice[]): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tempPath = `${this.filePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tempPath, JSON.stringify(devices, null, 2), 'utf-8');
      fs.renameSync(tempPath, this.filePath);
    } catch (err) {
      console.error('[RecentDevicesStore] Failed to save devices to disk:', err);
    }
  }
}

export interface RecentDevicesStoreOptions {
  maxRecentDevices?: number;
  storage?: IRecentDevicesStorage;
  filePath?: string;
}

export interface AddRecentDeviceInput {
  ip: string;
  port: number;
  name?: string;
  model?: string;
  brand?: DeviceBrand;
  lastConnected?: number;
  lastSeen?: number;
}

export class RecentDevicesStore {
  private devices: RecentDevice[] = [];
  private readonly maxRecentDevices: number;
  private readonly storage: IRecentDevicesStorage;

  constructor(options: RecentDevicesStoreOptions = {}) {
    this.maxRecentDevices = options.maxRecentDevices ?? 20;

    if (options.storage) {
      this.storage = options.storage;
    } else if (options.filePath) {
      this.storage = new JsonFileRecentDevicesStorage(options.filePath);
    } else {
      this.storage = new InMemoryRecentDevicesStorage();
    }

    this.init();
  }

  private init(): void {
    try {
      const loaded = this.storage.load();
      if (Array.isArray(loaded)) {
        this.devices = this.sanitizeAndSort(loaded);
      } else if (loaded && typeof (loaded as Promise<RecentDevice[]>).then === 'function') {
        (loaded as Promise<RecentDevice[]>)
          .then((res) => {
            if (Array.isArray(res)) {
              this.devices = this.sanitizeAndSort(res);
            }
          })
          .catch(() => {});
      }
    } catch {
      this.devices = [];
    }
  }

  public getRecentDevices(): RecentDevice[] {
    return this.devices.map((d) => ({
      ...d,
      model: d.name,
      lastSeen: d.lastConnected,
    }));
  }

  public getDevice(idOrAddress: string): RecentDevice | undefined {
    return this.devices.find(
      (d) =>
        d.id === idOrAddress ||
        d.address === idOrAddress ||
        `${d.ip}:${d.port}` === idOrAddress
    );
  }

  public addRecentDevice(entry: AddRecentDeviceInput): RecentDevice {
    const address = `${entry.ip}:${entry.port}`;
    const now = entry.lastConnected ?? entry.lastSeen ?? Date.now();
    const brand = entry.brand ?? 'generic';
    const rawName = (entry.name || entry.model || '').trim();
    const name = rawName || address;

    // Check if an existing entry matches address, or matches physical IP and non-generic model name
    const existingIndex = this.devices.findIndex(
      (d) =>
        d.id === address ||
        d.address === address ||
        (d.ip === entry.ip && rawName.length > 0 && d.name === rawName)
    );

    let created: RecentDevice;

    if (existingIndex !== -1) {
      const existing = this.devices[existingIndex];
      created = {
        ...existing,
        id: address,
        address,
        ip: entry.ip,
        port: entry.port,
        name: rawName.length > 0 ? rawName : existing.name,
        model: rawName.length > 0 ? rawName : existing.name,
        brand: entry.brand ?? existing.brand,
        lastConnected: now,
        lastSeen: now,
      };
      this.devices.splice(existingIndex, 1);
    } else {
      created = {
        id: address,
        address,
        ip: entry.ip,
        port: entry.port,
        name,
        model: name,
        brand,
        lastConnected: now,
        lastSeen: now,
      };
    }

    // Insert at front (MRU ordering)
    this.devices.unshift(created);

    // Enforce max capacity constraint
    if (this.devices.length > this.maxRecentDevices) {
      this.devices = this.devices.slice(0, this.maxRecentDevices);
    }

    void this.storage.save(this.devices);
    return { ...created };
  }

  public removeRecentDevice(idOrAddress: string): boolean {
    const initialLen = this.devices.length;
    this.devices = this.devices.filter(
      (d) =>
        d.id !== idOrAddress &&
        d.address !== idOrAddress &&
        `${d.ip}:${d.port}` !== idOrAddress
    );
    const removed = this.devices.length < initialLen;
    if (removed) {
      void this.storage.save(this.devices);
    }
    return removed;
  }

  public clearRecentDevices(): void {
    this.devices = [];
    void this.storage.save(this.devices);
  }

  public size(): number {
    return this.devices.length;
  }

  private sanitizeAndSort(items: RecentDevice[]): RecentDevice[] {
    return items
      .filter((d) => d && typeof d.ip === 'string' && typeof d.port === 'number')
      .map((d) => {
        const address = d.address || `${d.ip}:${d.port}`;
        const name = d.name || d.model || address;
        const lastConnected = d.lastConnected ?? d.lastSeen ?? Date.now();
        return {
          id: d.id || address,
          address,
          ip: d.ip,
          port: d.port,
          name,
          model: name,
          brand: d.brand || 'generic',
          lastConnected,
          lastSeen: lastConnected,
        };
      })
      .sort((a, b) => b.lastConnected - a.lastConnected)
      .slice(0, this.maxRecentDevices);
  }
}
