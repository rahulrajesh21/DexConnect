import React from 'react';
import { Square, MonitorPlay, Loader2 } from 'lucide-react';
import type { ActiveSession } from '../types';

interface SessionStatusBarProps {
  session: ActiveSession;
  onStop: (sessionId: string) => void;
  isStopping: boolean;
}

export const SessionStatusBar: React.FC<SessionStatusBarProps> = ({
  session,
  onStop,
  isStopping,
}) => {
  const formatProfile = (p: string) => {
    switch (p) {
      case 'samsung_dex':
        return 'Samsung DeX';
      case 'motorola_ready_for':
        return 'Motorola Smart Connect';
      case 'universal_desktop':
        return 'Universal Android Desktop';
      case 'screen_mirror':
        return 'Screen Mirror';
      default:
        return p;
    }
  };

  return (
    <div className="p-3.5 rounded-xl border border-emerald-500/40 bg-gradient-to-r from-emerald-950/40 to-[#0e1622]/80 backdrop-blur-md flex items-center justify-between shadow-lg shadow-emerald-950/20 animate-in fade-in slide-in-from-top-2 duration-200">
      <div className="flex items-center space-x-3">
        <div className="relative">
          <div className="w-9 h-9 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
            <MonitorPlay className="w-5 h-5" />
          </div>
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400" />
        </div>

        <div>
          <div className="flex items-center space-x-2">
            <span className="font-semibold text-sm text-white">{formatProfile(session.profile)}</span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 uppercase font-medium">
              Active
            </span>
          </div>
          <div className="text-xs text-gray-400 flex items-center space-x-2 mt-0.5 font-mono">
            <span>PID: {session.pid}</span>
            <span>•</span>
            <span>Device: {session.config?.modelName || session.deviceSerial}</span>
            <span>•</span>
            <span className="text-emerald-400/80">{session.config?.resolution} @ {session.config?.refreshRate}fps</span>
          </div>
        </div>
      </div>

      <button
        type="button"
        disabled={isStopping}
        onClick={() => onStop(session.sessionId)}
        className="flex items-center space-x-2 px-3.5 py-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/30 transition-all font-medium text-xs disabled:opacity-50 cursor-pointer"
        title="Stop Virtual Display Session"
      >
        {isStopping ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Stopping...</span>
          </>
        ) : (
          <>
            <Square className="w-3.5 h-3.5 fill-red-400 text-red-400" />
            <span>Stop Session</span>
          </>
        )}
      </button>
    </div>
  );
};
