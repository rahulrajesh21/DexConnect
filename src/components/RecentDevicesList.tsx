import React from 'react';
import { History, Wifi, ArrowRight, Loader2 } from 'lucide-react';
import type { RecentWirelessDevice } from '../types';

interface RecentDevicesListProps {
  recentDevices: RecentWirelessDevice[];
  onConnect: (address: string) => void;
  connectingAddress: string | null;
}

export const RecentDevicesList: React.FC<RecentDevicesListProps> = ({
  recentDevices,
  onConnect,
  connectingAddress,
}) => {
  if (recentDevices.length === 0) {
    return null;
  }

  const formatLastSeen = (timestamp: number) => {
    if (!timestamp) return 'Previously paired';
    const diffMs = Date.now() - timestamp;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.floor(diffHours / 24)}d ago`;
  };

  return (
    <div className="flex flex-col space-y-2 mt-4 pt-4 border-t border-white/5">
      <div className="flex items-center space-x-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
        <History className="w-3.5 h-3.5" />
        <span>Recent Wireless Devices</span>
      </div>

      <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
        {recentDevices.map((item) => {
          const address = `${item.ip}:${item.port}`;
          const isConnecting = connectingAddress === address;

          return (
            <div
              key={address}
              className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] transition-all text-xs"
            >
              <div className="min-w-0 flex items-center space-x-2">
                <Wifi className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <div className="truncate">
                  <div className="text-gray-200 font-medium truncate">{item.model || address}</div>
                  <div className="text-[11px] text-gray-500 font-mono">
                    {address} • {formatLastSeen(item.lastSeen)}
                  </div>
                </div>
              </div>

              <button
                type="button"
                disabled={isConnecting}
                onClick={() => onConnect(address)}
                className="flex items-center space-x-1 px-2.5 py-1 text-[11px] font-medium rounded-md bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 transition-all shrink-0 disabled:opacity-50"
                title={`Connect to ${address}`}
              >
                {isConnecting ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <>
                    <span>Connect</span>
                    <ArrowRight className="w-3 h-3" />
                  </>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
