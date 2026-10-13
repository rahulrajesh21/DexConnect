import React from 'react';
import { Sliders, Volume2, VolumeX, Play, Loader2 } from 'lucide-react';
import type { ResolutionPreset, VideoCodec, RefreshRate } from '../types';

interface QuickControlsProps {
  resolution: ResolutionPreset;
  setResolution: (val: ResolutionPreset) => void;
  dpi: number;
  setDpi: (val: number) => void;
  fps: RefreshRate;
  setFps: (val: RefreshRate) => void;
  codec: VideoCodec;
  setCodec: (val: VideoCodec) => void;
  audioRouting: boolean;
  setAudioRouting: (val: boolean) => void;
  onLaunch: () => void;
  isLaunching: boolean;
  hasSelectedDevice: boolean;
  selectedProfileName: string;
}

export const QuickControls: React.FC<QuickControlsProps> = ({
  resolution,
  setResolution,
  dpi,
  setDpi,
  fps,
  setFps,
  codec,
  setCodec,
  audioRouting,
  setAudioRouting,
  onLaunch,
  isLaunching,
  hasSelectedDevice,
  selectedProfileName,
}) => {
  return (
    <div className="p-4 rounded-xl border border-white/10 bg-[#121824]/70 backdrop-blur-md flex flex-col space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2 text-sm font-semibold text-gray-200">
          <Sliders className="w-4 h-4 text-blue-400" />
          <span>Quick Controls</span>
        </div>
        <span className="text-xs text-gray-400">Display Engine & Encoder Tuning</span>
      </div>

      {/* Grid of parameters */}
      <div className="grid grid-cols-5 gap-3 text-xs">
        {/* Resolution selector */}
        <div className="space-y-1.5">
          <label className="text-gray-400 font-medium block">Resolution</label>
          <select
            value={resolution}
            onChange={(e) => setResolution(e.target.value as ResolutionPreset)}
            className="w-full bg-[#182130] border border-white/10 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-blue-500 font-mono text-xs cursor-pointer"
          >
            <option value="1080p">1080p (1920×1080)</option>
            <option value="1440p">1440p (2560×1440)</option>
            <option value="4k">4K UHD (3840×2160)</option>
            <option value="retina_16_10">Retina (2560×1600)</option>
          </select>
        </div>

        {/* DPI slider */}
        <div className="space-y-1.5">
          <div className="flex justify-between">
            <label className="text-gray-400 font-medium">Density (DPI)</label>
            <span className="text-blue-400 font-mono font-medium">{dpi}</span>
          </div>
          <input
            type="range"
            min="160"
            max="320"
            step="10"
            value={dpi}
            onChange={(e) => setDpi(Number(e.target.value))}
            className="w-full accent-blue-500 cursor-pointer"
          />
        </div>

        {/* Refresh Rate */}
        <div className="space-y-1.5">
          <label className="text-gray-400 font-medium block">Max FPS</label>
          <select
            value={fps}
            onChange={(e) => setFps(Number(e.target.value) as RefreshRate)}
            className="w-full bg-[#182130] border border-white/10 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-blue-500 font-mono text-xs cursor-pointer"
          >
            <option value={60}>60 FPS (Stable)</option>
            <option value={90}>90 FPS (Smooth)</option>
            <option value={120}>120 FPS (ProMotion)</option>
          </select>
        </div>

        {/* Video Codec */}
        <div className="space-y-1.5">
          <label className="text-gray-400 font-medium block">Video Codec</label>
          <div className="flex rounded-lg bg-[#182130] p-0.5 border border-white/10">
            <button
              type="button"
              onClick={() => setCodec('h264')}
              className={`flex-1 py-1 text-center font-mono text-[11px] rounded-md transition-all ${
                codec === 'h264'
                  ? 'bg-blue-600 text-white font-medium shadow-sm'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              H.264
            </button>
            <button
              type="button"
              onClick={() => setCodec('h265')}
              className={`flex-1 py-1 text-center font-mono text-[11px] rounded-md transition-all ${
                codec === 'h265'
                  ? 'bg-blue-600 text-white font-medium shadow-sm'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              H.265
            </button>
          </div>
        </div>

        {/* Audio Routing */}
        <div className="space-y-1.5">
          <label className="text-gray-400 font-medium block">Mac Audio</label>
          <button
            type="button"
            onClick={() => setAudioRouting(!audioRouting)}
            className={`w-full flex items-center justify-center space-x-1.5 rounded-lg px-2.5 py-1.5 border transition-all text-xs font-medium ${
              audioRouting
                ? 'bg-blue-600/20 border-blue-500/40 text-blue-300'
                : 'bg-white/5 border-white/10 text-gray-400'
            }`}
          >
            {audioRouting ? (
              <>
                <Volume2 className="w-3.5 h-3.5" />
                <span>Forwarding</span>
              </>
            ) : (
              <>
                <VolumeX className="w-3.5 h-3.5" />
                <span>Muted</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Launch Action Bar */}
      <div className="pt-2 flex items-center justify-between border-t border-white/5">
        <div className="text-xs text-gray-400">
          Ready to launch <span className="text-white font-medium">{selectedProfileName}</span> with UHID passthrough
        </div>

        <button
          type="button"
          disabled={!hasSelectedDevice || isLaunching}
          onClick={onLaunch}
          className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-medium shadow-lg shadow-blue-600/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          {isLaunching ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Launching Session...</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-white" />
              <span>Launch Desktop Session</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
