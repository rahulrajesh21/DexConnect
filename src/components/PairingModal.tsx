import React, { useState } from 'react';
import { X, Wifi, Shield, ArrowRight, Loader2, AlertCircle, CheckCircle } from 'lucide-react';
import type { PairWirelessPayload } from '../types';

interface PairingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPair: (payload: PairWirelessPayload) => Promise<boolean>;
}

export const PairingModal: React.FC<PairingModalProps> = ({
  isOpen,
  onClose,
  onPair,
}) => {
  const [ip, setIp] = useState<string>('');
  const [pairingPort, setPairingPort] = useState<string>('');
  const [code, setCode] = useState<string>('');
  const [connectPort, setConnectPort] = useState<string>('5555');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);

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
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step Guide */}
        <div className="p-5 space-y-4 text-xs">
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
                onClick={onClose}
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
      </div>
    </div>
  );
};
