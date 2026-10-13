import { useEffect, useState } from 'react'
import {
  Smartphone,
  Tv,
  Monitor,
  Cast,
  RefreshCw,
  Wifi,
  Usb,
  ShieldCheck,
  Cpu,
  Layers,
  Volume2,
  Sliders
} from 'lucide-react'
import type { DeviceInfo, SystemStatus, LaunchProfile, ResolutionPreset } from './types'

export default function App() {
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null)
  const [selectedSerial, setSelectedSerial] = useState<string | null>(null)
  const [selectedProfile, setSelectedProfile] = useState<LaunchProfile>('samsung_dex')
  const [resolution, setResolution] = useState<ResolutionPreset>('1440p')
  const [dpi, setDpi] = useState<number>(240)
  const [fps, setFps] = useState<number>(60)
  const [audioRouting, setAudioRouting] = useState<boolean>(true)
  const [loading, setLoading] = useState<boolean>(false)

  useEffect(() => {
    // Initial fetch of system status
    if (window.dexconnect?.getSystemStatus) {
      window.dexconnect.getSystemStatus().then(setSystemStatus).catch(console.error)
    }

    // Initial fetch of devices
    if (window.dexconnect?.getDevices) {
      window.dexconnect.getDevices().then((devs) => {
        setDevices(devs)
        if (devs.length > 0 && !selectedSerial) {
          setSelectedSerial(devs[0].serial)
        }
      }).catch(console.error)
    }

    // Subscribe to live device changes
    if (window.dexconnect?.onDevicesUpdated) {
      const unsubscribe = window.dexconnect.onDevicesUpdated((updatedDevices) => {
        setDevices(updatedDevices)
        if (updatedDevices.length > 0 && (!selectedSerial || !updatedDevices.some(d => d.serial === selectedSerial))) {
          setSelectedSerial(updatedDevices[0].serial)
        }
      })
      return () => unsubscribe()
    }
  }, [selectedSerial])

  const refreshDevices = async () => {
    if (!window.dexconnect?.getDevices) return
    setLoading(true)
    try {
      const devs = await window.dexconnect.getDevices()
      setDevices(devs)
    } finally {
      setLoading(false)
    }
  }

  const profiles = [
    {
      id: 'samsung_dex' as LaunchProfile,
      title: 'Samsung DeX Desktop',
      subtitle: 'Native multi-window Samsung workstation',
      badge: 'DeX 🪐',
      color: 'from-blue-600/30 to-indigo-900/40',
      borderHover: 'hover:border-blue-500/50',
      icon: Tv,
    },
    {
      id: 'motorola_ready_for' as LaunchProfile,
      title: 'Motorola Smart Connect',
      subtitle: 'Motorola Ready For desktop interface',
      badge: 'Ready For ⚡',
      color: 'from-cyan-600/30 to-blue-900/40',
      borderHover: 'hover:border-cyan-500/50',
      icon: Monitor,
    },
    {
      id: 'universal_desktop' as LaunchProfile,
      title: 'Universal Android Desktop',
      subtitle: 'Virtual display freeform desktop mode',
      badge: 'Android 🖥️',
      color: 'from-purple-600/30 to-violet-900/40',
      borderHover: 'hover:border-purple-500/50',
      icon: Layers,
    },
    {
      id: 'screen_mirror' as LaunchProfile,
      title: 'Low-Latency Screen Mirror',
      subtitle: 'Zero-latency phone display mirroring',
      badge: 'Mirror 📱',
      color: 'from-emerald-600/30 to-teal-900/40',
      borderHover: 'hover:border-emerald-500/50',
      icon: Cast,
    },
  ]

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0B0F17] text-gray-200 select-none overflow-hidden">
      {/* Frameless macOS Titlebar */}
      <div className="h-10 flex items-center justify-between px-4 bg-[#0E131E]/80 backdrop-blur-md border-b border-white/5 drag-region shrink-0">
        <div className="flex items-center space-x-3">
          {/* Traffic light spacer */}
          <div className="w-16 h-full no-drag" />
          <div className="flex items-center space-x-2">
            <span className="font-semibold text-sm tracking-wide text-white">DexConnect</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 font-mono">v0.1.0 M1</span>
          </div>
        </div>

        {/* System Status Indicators */}
        <div className="flex items-center space-x-3 no-drag text-xs">
          <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-white/5 border border-white/5">
            <Cpu className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-gray-400">ADB:</span>
            <span className={systemStatus?.adb ? 'text-emerald-400 font-medium' : 'text-amber-400 font-medium'}>
              {systemStatus?.adb ? 'Ready' : 'Mock/Searching'}
            </span>
          </div>
          <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-white/5 border border-white/5">
            <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
            <span className="text-gray-400">Scrcpy:</span>
            <span className={systemStatus?.scrcpy ? 'text-emerald-400 font-medium' : 'text-amber-400 font-medium'}>
              {systemStatus?.scrcpyVersion || (systemStatus?.scrcpy ? 'v5.0.1' : 'Ready')}
            </span>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden p-5 space-x-5">
        {/* Left Column: Device Supervision */}
        <div className="w-80 flex flex-col space-y-4 shrink-0">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-wide text-gray-300 uppercase">Connected Devices</h2>
            <button
              onClick={refreshDevices}
              className={`p-1.5 rounded-md hover:bg-white/10 text-gray-400 hover:text-white transition-all ${
                loading ? 'animate-spin' : ''
              }`}
              title="Refresh Devices"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
            {devices.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-center rounded-xl border border-white/5 bg-white/[0.02]">
                <Smartphone className="w-10 h-10 text-gray-600 mb-2 stroke-[1.5]" />
                <p className="text-sm text-gray-400 font-medium">No Devices Detected</p>
                <p className="text-xs text-gray-600 mt-1">Connect your device via USB cable or Wi-Fi</p>
              </div>
            ) : (
              devices.map((device) => {
                const isSelected = selectedSerial === device.serial
                return (
                  <div
                    key={device.serial}
                    onClick={() => setSelectedSerial(device.serial)}
                    className={`p-3.5 rounded-xl border cursor-pointer transition-all duration-150 ${
                      isSelected
                        ? 'bg-blue-600/15 border-blue-500/50 shadow-glow'
                        : 'bg-white/[0.03] border-white/5 hover:bg-white/[0.06] hover:border-white/10'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-2.5">
                        <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400">
                          <Smartphone className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="font-medium text-sm text-white leading-tight">{device.model || 'Device'}</div>
                          <div className="text-xs text-gray-400 mt-0.5 font-mono">{device.serial}</div>
                        </div>
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-mono uppercase bg-white/10 text-gray-300">
                        {device.brand}
                      </span>
                    </div>

                    <div className="mt-3 flex items-center justify-between text-xs text-gray-400 pt-2 border-t border-white/5">
                      <div className="flex items-center space-x-1">
                        {device.connectionType === 'wifi' ? (
                          <Wifi className="w-3.5 h-3.5 text-blue-400" />
                        ) : (
                          <Usb className="w-3.5 h-3.5 text-emerald-400" />
                        )}
                        <span className="capitalize">{device.connectionType}</span>
                      </div>
                      <div className="flex items-center space-x-1 font-mono">
                        <span>{device.battery.level}%</span>
                        <span className="text-[10px] text-gray-500">({device.battery.isCharging ? '⚡' : '🔋'})</span>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

          {/* Right Column: Launch Profiles & Controls */}
        <div className="flex-1 flex flex-col space-y-5 overflow-y-auto pr-1">
          <div>
            <h2 className="text-sm font-semibold tracking-wide text-gray-300 uppercase mb-3">Launch Profiles</h2>
            <div className="grid grid-cols-2 gap-3.5">
              {profiles.map((p) => {
                const isSelected = selectedProfile === p.id
                const IconComponent = p.icon
                return (
                  <div
                    key={p.id}
                    onClick={() => setSelectedProfile(p.id)}
                    className={`relative p-4 rounded-xl border cursor-pointer transition-all duration-200 overflow-hidden ${
                      isSelected
                        ? `bg-gradient-to-br ${p.color} border-blue-400/60 shadow-glow`
                        : `bg-white/[0.03] border-white/5 hover:bg-white/[0.06] ${p.borderHover}`
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center text-white mb-3">
                        <IconComponent className="w-5 h-5" />
                      </div>
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-white/10 text-gray-200">
                        {p.badge}
                      </span>
                    </div>
                    <div className="font-semibold text-sm text-white">{p.title}</div>
                    <div className="text-xs text-gray-400 mt-1 leading-snug">{p.subtitle}</div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Quick Controls Section */}
          <div className="p-4 rounded-xl border border-white/5 bg-white/[0.02] flex flex-col space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-sm font-semibold text-gray-200">
                <Sliders className="w-4 h-4 text-blue-400" />
                <span>Quick Controls</span>
              </div>
              <span className="text-xs text-gray-500">Virtual Display & Encoder</span>
            </div>

            <div className="grid grid-cols-4 gap-3 text-xs">
              {/* Resolution selector */}
              <div className="space-y-1.5">
                <label className="text-gray-400 font-medium">Resolution</label>
                <select
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value as ResolutionPreset)}
                  className="w-full bg-[#141A23] border border-white/10 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="1080p">1080p (FHD)</option>
                  <option value="1440p">1440p (QHD)</option>
                  <option value="4k">4K (UHD)</option>
                  <option value="retina_16_10">Retina (16:10)</option>
                </select>
              </div>

              {/* DPI slider */}
              <div className="space-y-1.5">
                <div className="flex justify-between">
                  <label className="text-gray-400 font-medium">DPI</label>
                  <span className="text-gray-300 font-mono">{dpi}</span>
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

              {/* FPS selector */}
              <div className="space-y-1.5">
                <label className="text-gray-400 font-medium">Max FPS</label>
                <select
                  value={fps}
                  onChange={(e) => setFps(Number(e.target.value))}
                  className="w-full bg-[#141A23] border border-white/10 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-blue-500"
                >
                  <option value={60}>60 FPS</option>
                  <option value={90}>90 FPS</option>
                  <option value={120}>120 FPS</option>
                </select>
              </div>

              {/* Audio Routing */}
              <div className="space-y-1.5">
                <label className="text-gray-400 font-medium">Audio Routing</label>
                <button
                  type="button"
                  onClick={() => setAudioRouting(!audioRouting)}
                  className={`w-full flex items-center justify-center space-x-1.5 rounded-lg px-2.5 py-1.5 border transition-all ${
                    audioRouting
                      ? 'bg-blue-600/20 border-blue-500/40 text-blue-300'
                      : 'bg-white/5 border-white/10 text-gray-400'
                  }`}
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>{audioRouting ? 'Enabled' : 'Muted'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
