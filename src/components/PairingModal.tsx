import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Wifi,
  Shield,
  ArrowRight,
  Loader2,
  AlertCircle,
  CheckCircle,
  QrCode,
  KeyRound,
  RefreshCw,
} from 'lucide-react';
import type { PairWirelessPayload, QrPairingSession, QrPairingProgress } from '../types';

export interface PairingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPair: (payload: PairWirelessPayload) => Promise<boolean>;
  initialTab?: 'qr' | 'manual';
}

export const PairingModal: React.FC<PairingModalProps> = ({
  isOpen,
  onClose,
  onPair,
  initialTab = 'qr',
}) => {
  const [activeTab, setActiveTab] = useState<'qr' | 'manual'>(initialTab);

  // Manual Form State
  const [ip, setIp] = useState<string>('');
  const [pairingPort, setPairingPort] = useState<string>('');
  const [code, setCode] = useState<string>('');
  const [connectPort, setConnectPort] = useState<string>('5555');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);

  // QR Pairing State
  const [qrSession, setQrSession] = useState<QrPairingSession | null>(null);
  const [qrProgress, setQrProgress] = useState<QrPairingProgress | null>(null);
  const [qrLoading, setQrLoading] = useState<boolean>(false);
  const [qrError, setQrError] = useState<string | null>(null);

  // Start QR session function
  const initQrSession = useCallback(async () => {
    if (!window.dexconnect?.startQrPairing) return;
    setQrLoading(true);
    setQrError(null);
    try {
      const session = await window.dexconnect.startQrPairing();
      setQrSession(session);
    } catch (err: unknown) {
      setQrError(err instanceof Error ? err.message : 'Failed to initialize QR code pairing');
    } finally {
      setQrLoading(false);
    }
  }, []);

  // Handle modal open/close & QR lifecycle
  useEffect(() => {
    if (!isOpen) {
      if (window.dexconnect?.stopQrPairing) {
        void window.dexconnect.stopQrPairing().catch(() => {});
      }
      setQrSession(null);
      setQrProgress(null);
      setQrError(null);
      setError(null);
      setSuccess(false);
      return;
    }

    if (activeTab === 'qr') {
      void initQrSession();
    } else {
      if (window.dexconnect?.stopQrPairing) {
        void window.dexconnect.stopQrPairing().catch(() => {});
      }
      setQrSession(null);
    }
  }, [isOpen, activeTab, initQrSession]);

  // Listen to QR progress updates
  useEffect(() => {
    if (!isOpen || activeTab !== 'qr' || !window.dexconnect?.onQrPairingProgress) {
      return;
    }

    const unsub = window.dexconnect.onQrPairingProgress((progress: QrPairingProgress) => {
      setQrProgress(progress);
      if (progress.state === 'completed') {
        setSuccess(true);
        setTimeout(() => {
          setSuccess(false);
          onClose();
        }, 1500);
      } else if (progress.state === 'error') {
        setQrError(progress.error || 'Pairing error');
      } else if (progress.state === 'timeout') {
        setQrError('QR code session timed out. Tap refresh to generate a new code.');
      }
    });

    return () => {
      unsub();
    };
  }, [isOpen, activeTab, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanIp = ip.trim();
    const pPort = parseInt(pairingPort.trim(), 10);
    const cPort = parseInt(connectPort.trim(), 10);
    const cleanCode = code.trim();

    if (!cleanIp) {
      setError('IP address is required');
      return;
    }

    if (isNaN(pPort) || pPort < 1 || pPort > 65535) {
      setError('Pairing port must be a valid number between 1 and 65535');
      return;
    }

    if (!/^\d{6}$/.test(cleanCode)) {
      setError('Pairing code must be exactly 6 digits');
      return;
    }

    if (isNaN(cPort) || cPort < 1 || cPort > 65535) {
      setError('Connect port must be a valid number between 1 and 65535 (default 5555)');
      return;
    }

    setLoading(true);
    try {
      const ok = await onPair({
        ip: cleanIp,
        pairingPort: pPort,
        code: cleanCode,
        connectPort: cPort,
      });

      if (ok) {
        setSuccess(true);
        setTimeout(() => {
          setSuccess(false);
          onClose();
        }, 1500);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Pairing failed. Verify phone dialog is still open.');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (window.dexconnect?.stopQrPairing) {
      void window.dexconnect.stopQrPairing().catch(() => {});
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-[#111722] border border-white/10 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 bg-white/[0.02]">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center">
              <Wifi className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-white text-sm">Pair Wireless Debugging</h3>
              <p className="text-[11px] text-gray-400">Android 11+ Wi-Fi Pairing Engine</p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-white/5 bg-white/[0.01] px-5 pt-3 gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('qr')}
            className={`flex items-center space-x-2 pb-3 px-3 text-xs font-semibold border-b-2 transition-all ${
              activeTab === 'qr'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-400 hover:text-gray-300'
            }`}
          >
            <QrCode className="w-4 h-4" />
            <span>Scan QR Code</span>
            <span className="text-[10px] bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded-full font-normal">
              Instant
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('manual')}
            className={`flex items-center space-x-2 pb-3 px-3 text-xs font-semibold border-b-2 transition-all ${
              activeTab === 'manual'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-400 hover:text-gray-300'
            }`}
          >
            <KeyRound className="w-4 h-4" />
            <span>Manual 6-Digit PIN</span>
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-5 space-y-4 text-xs">
          {activeTab === 'qr' ? (
            /* QR Code Tab */
            <div className="space-y-4">
              <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-gray-300 space-y-1">
                <div className="font-medium text-blue-300 flex items-center space-x-1.5">
                  <Shield className="w-3.5 h-3.5" />
                  <span>How to pair with QR code:</span>
                </div>
                <ol className="list-decimal list-inside space-y-0.5 text-[11px] text-gray-400 pl-1">
                  <li>Open <strong>Settings</strong> → <strong>Developer options</strong></li>
                  <li>Enable <strong>Wireless debugging</strong></li>
                  <li>Tap <strong>"Pair device with QR code"</strong></li>
                  <li>Point your phone camera at the QR code below</li>
                </ol>
              </div>

              {/* QR Code Presentation */}
              <div className="flex flex-col items-center justify-center py-2 space-y-3">
                {qrLoading ? (
                  <div className="w-56 h-56 rounded-2xl bg-white/5 border border-white/10 flex flex-col items-center justify-center text-gray-400 space-y-2">
                    <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
                    <span className="text-xs">Generating pairing QR code...</span>
                  </div>
                ) : qrSession?.qrDataUrl ? (
                  <div className="relative p-3 bg-white rounded-2xl shadow-2xl ring-4 ring-blue-500/20">
                    <img
                      src={qrSession.qrDataUrl}
                      alt="Wireless Pairing QR Code"
                      className="w-52 h-52 object-contain rounded-lg"
                    />
                  </div>
                ) : (
                  <div className="w-56 h-56 rounded-2xl bg-white/5 border border-white/10 flex flex-col items-center justify-center text-gray-400 space-y-2 text-center p-4">
                    <AlertCircle className="w-8 h-8 text-amber-400" />
                    <span className="text-xs">QR code not loaded. Tap below to generate.</span>
                    <button
                      type="button"
                      onClick={initQrSession}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium"
                    >
                      Generate QR Code
                    </button>
                  </div>
                )}

                {/* Status Indicator Pill */}
                <div className="flex items-center space-x-2 px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/10 text-xs text-gray-300">
                  {qrProgress?.state === 'device_spotted' || qrProgress?.state === 'pairing' ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                      <span className="text-blue-300 font-medium">Device spotted! Authenticating...</span>
                    </>
                  ) : qrProgress?.state === 'connecting' ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                      <span className="text-cyan-300 font-medium">Connecting wireless session...</span>
                    </>
                  ) : qrProgress?.state === 'completed' || success ? (
                    <>
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-300 font-medium">Paired & connected successfully!</span>
                    </>
                  ) : qrProgress?.state === 'error' || qrError ? (
                    <>
                      <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                      <span className="text-red-300 font-medium">{qrError || qrProgress?.error || 'Pairing error'}</span>
                    </>
                  ) : qrProgress?.state === 'timeout' ? (
                    <>
                      <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-amber-300 font-medium">Session timed out</span>
                    </>
                  ) : (
                    <>
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500"></span>
                      </span>
                      <span>Waiting for camera scan...</span>
                    </>
                  )}
                </div>
              </div>

              {/* QR Footer Controls */}
              <div className="flex items-center justify-between pt-2 border-t border-white/5">
                <button
                  type="button"
                  onClick={initQrSession}
                  disabled={qrLoading}
                  className="flex items-center space-x-1.5 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 font-medium text-xs transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${qrLoading ? 'animate-spin' : ''}`} />
                  <span>Refresh Code</span>
                </button>

                <button
                  type="button"
                  onClick={handleClose}
                  className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 font-medium text-xs transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          ) : (
            /* Manual PIN Tab */
            <div className="space-y-4">
              <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-gray-300 space-y-1">
                <div className="font-medium text-blue-300 flex items-center space-x-1.5">
                  <Shield className="w-3.5 h-3.5" />
                  <span>How to find on your Android device:</span>
                </div>
                <ol className="list-decimal list-inside space-y-0.5 text-[11px] text-gray-400 pl-1">
                  <li>Open <strong>Settings</strong> → <strong>Developer options</strong></li>
                  <li>Enable <strong>Wireless debugging</strong></li>
                  <li>Tap <strong>"Pair device with pairing code"</strong></li>
                </ol>
              </div>

              {error && (
                <div className="flex items-center space-x-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {success && (
                <div className="flex items-center space-x-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs">
                  <CheckCircle className="w-4 h-4 shrink-0" />
                  <span>Paired and connected wirelessly!</span>
                </div>
              )}

              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="grid grid-cols-3 gap-2.5">
                  <div className="col-span-2 space-y-1">
                    <label className="text-gray-400 font-medium block">Phone IP Address</label>
                    <input
                      type="text"
                      placeholder="e.g. 192.168.1.100"
                      value={ip}
                      onChange={(e) => setIp(e.target.value)}
                      className="w-full bg-[#182130] border border-white/10 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-blue-500"
                      required
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-gray-400 font-medium block">Pairing Port</label>
                    <input
                      type="number"
                      placeholder="e.g. 37841"
                      value={pairingPort}
                      onChange={(e) => setPairingPort(e.target.value)}
                      className="w-full bg-[#182130] border border-white/10 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-blue-500"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <label className="text-gray-400 font-medium block">6-Digit Pairing Code</label>
                    <input
                      type="text"
                      maxLength={6}
                      placeholder="e.g. 123456"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      className="w-full bg-[#182130] border border-white/10 rounded-lg px-3 py-2 text-white font-mono tracking-widest text-center text-sm font-semibold focus:outline-none focus:border-blue-500"
                      required
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-gray-400 font-medium block">Connect Port</label>
                    <input
                      type="number"
                      placeholder="5555"
                      value={connectPort}
                      onChange={(e) => setConnectPort(e.target.value)}
                      className="w-full bg-[#182130] border border-white/10 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div className="pt-2 flex justify-end space-x-2">
                  <button
                    type="button"
                    onClick={handleClose}
                    className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 font-medium transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium transition-all shadow-md shadow-blue-600/30 disabled:opacity-50"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Pairing...</span>
                      </>
                    ) : (
                      <>
                        <span>Pair & Connect</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
