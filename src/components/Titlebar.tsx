import React from 'react';
import { Cpu, ShieldCheck, RefreshCw, Wifi, Sparkles } from 'lucide-react';
import type { SystemStatus } from '../types';

interface TitlebarProps {
  systemStatus: SystemStatus | null;
  onRefreshDevices: () => void;
  onOpenPairingModal: () => void;
  isRefreshing: boolean;
}

export const Titlebar: React.FC<TitlebarProps> = ({
  systemStatus,
  onRefreshDevices,
  onOpenPairingModal,
  isRefreshing,
}) => {
  return (
    <header className="h-11 flex items-center justify-between px-4 bg-[#0E131E]/90 backdrop-blur-md border-b border-white/5 drag-region shrink-0">
      <div className="flex items-center space-x-3">
        {/* Traffic lights spacer on macOS */}
        <div className="w-16 h-full no-drag" />
        <div className="flex items-center space-x-2.5">
          <div className="w-6 h-6 rounded-md bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-md">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <span className="font-semibold text-sm tracking-wide text-white">DexConnect</span>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-500/15 border border-blue-500/20 text-blue-300">
            macOS Desktop
          </span>
        </div>
      </div>

      {/* Right controls */}
      <div className="flex items-center space-x-2.5 no-drag text-xs">
        {/* ADB indicator */}
        <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/5">
          <Cpu className="w-3.5 h-3.5 text-blue-400" />
          <span className="text-gray-400">ADB:</span>
          <span className={systemStatus?.adb ? 'text-emerald-400 font-medium' : 'text-amber-400 font-medium'}>
            {systemStatus?.adb ? 'Ready' : 'Checking'}
          </span>
        </div>

        {/* Scrcpy indicator */}
        <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/5">
          <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
          <span className="text-gray-400">Scrcpy:</span>
          <span className={systemStatus?.scrcpy ? 'text-emerald-400 font-medium' : 'text-amber-400 font-medium'}>
            {systemStatus?.scrcpyVersion || (systemStatus?.scrcpy ? 'v5.0.1' : 'Ready')}
          </span>
        </div>

        {/* Pair Wireless button */}
        <button
          type="button"
          onClick={onOpenPairingModal}
          className="flex items-center space-x-1.5 px-3 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 transition-all font-medium"
          title="Pair Android 11+ Wireless Debugging"
        >
          <Wifi className="w-3.5 h-3.5" />
          <span>Pair Wireless</span>
        </button>

        {/* Refresh Devices button */}
        <button
          type="button"
          onClick={onRefreshDevices}
          className={`p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/10 text-gray-400 hover:text-white border border-white/5 transition-all ${
            isRefreshing ? 'animate-spin' : ''
          }`}
          title="Refresh Connected Devices"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};
