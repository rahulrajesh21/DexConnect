import React from 'react';
import { Smartphone, Wifi, Usb, BatteryCharging, Battery, ArrowRightLeft, Loader2 } from 'lucide-react';
import type { DeviceInfo } from '../types';

interface DeviceCardProps {
  device: DeviceInfo;
  isSelected: boolean;
  onSelect: (serial: string) => void;
  onMigrateToWifi: (serial: string) => void;
  isMigrating: boolean;
}

export const DeviceCard: React.FC<DeviceCardProps> = ({
  device,
  isSelected,
  onSelect,
  onMigrateToWifi,
  isMigrating,
}) => {
  const isUsb = device.connectionType === 'usb';
  const batteryPct = device.battery?.level ?? 100;
  const isCharging = device.battery?.isCharging ?? false;

  const getBrandBadge = () => {
    switch (device.brand) {
      case 'samsung':
        return { label: 'Samsung', color: 'bg-blue-500/15 text-blue-300 border-blue-500/20' };
      case 'motorola':
        return { label: 'Motorola', color: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/20' };
      default:
        return { label: 'Android', color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20' };
    }
  };

  const brandInfo = getBrandBadge();

  return (
    <div
      onClick={() => onSelect(device.serial)}
      className={`p-3.5 rounded-xl border cursor-pointer transition-all duration-200 select-none ${
        isSelected
          ? 'bg-blue-600/15 border-blue-500/60 shadow-[0_0_20px_-3px_rgba(59,130,246,0.3)]'
          : 'bg-white/[0.03] border-white/5 hover:bg-white/[0.06] hover:border-white/10'
      }`}
    >
      {/* Top Header: Brand & Model */}
      <div className="flex items-start justify-between">
        <div className="flex items-center space-x-2.5 min-w-0">
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
              isSelected ? 'bg-blue-500/20 text-blue-300' : 'bg-white/5 text-gray-400'
            }`}
          >
            <Smartphone className="w-5 h-5" />
          </div>
          <div className="truncate">
            <div className="font-semibold text-sm text-white truncate leading-tight">
              {device.model || 'Android Device'}
            </div>
            <div className="text-[11px] text-gray-400 mt-0.5 font-mono truncate">
              {device.serial}
            </div>
          </div>
        </div>

        <span
          className={`text-[10px] font-mono px-2 py-0.5 rounded border uppercase shrink-0 ${brandInfo.color}`}
        >
          {brandInfo.label}
        </span>
      </div>

      {/* Middle Details: Connection & Battery */}
      <div className="mt-3 flex items-center justify-between text-xs text-gray-300 pt-2.5 border-t border-white/5">
        <div className="flex items-center space-x-1.5">
          {isUsb ? (
            <span className="flex items-center space-x-1 text-emerald-400 font-medium">
              <Usb className="w-3.5 h-3.5" />
              <span>USB Cable</span>
            </span>
          ) : (
            <span className="flex items-center space-x-1 text-blue-400 font-medium">
              <Wifi className="w-3.5 h-3.5" />
              <span>Wi-Fi {device.ipAddress ? `(${device.ipAddress})` : ''}</span>
            </span>
          )}
        </div>

        <div className="flex items-center space-x-1 font-mono text-xs">
          {isCharging ? (
            <BatteryCharging className="w-3.5 h-3.5 text-amber-400" />
          ) : (
            <Battery className="w-3.5 h-3.5 text-gray-400" />
          )}
          <span>{batteryPct}%</span>
        </div>
      </div>

      {/* USB-to-Wireless Migration Shortcut */}
      {isUsb && (
        <div className="mt-2.5 pt-2 border-t border-white/5 flex justify-end">
          <button
            type="button"
            disabled={isMigrating}
            onClick={(e) => {
              e.stopPropagation();
              onMigrateToWifi(device.serial);
            }}
            className="flex items-center space-x-1.5 px-2.5 py-1 text-[11px] font-medium rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 transition-all disabled:opacity-50"
            title="Switch from USB to Wi-Fi (adb tcpip 5555)"
          >
            {isMigrating ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Switching...</span>
              </>
            ) : (
              <>
                <ArrowRightLeft className="w-3 h-3" />
                <span>Switch to Wi-Fi</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
};
