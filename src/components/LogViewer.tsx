import React, { useState, useEffect, useRef } from 'react';
import { Terminal, ChevronUp, ChevronDown, Trash2, Copy, Check } from 'lucide-react';
import type { SessionLogEntry } from '../types';

interface LogViewerProps {
  logs: SessionLogEntry[];
  onClearLogs: () => void;
}

export const LogViewer: React.FC<LogViewerProps> = ({ logs, onClearLogs }) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && typeof bottomRef.current?.scrollIntoView === 'function') {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, isOpen]);

  const handleCopy = () => {
    const text = logs.map((l) => l.text).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="border-t border-white/10 bg-[#0A0E17]/95 backdrop-blur-md shrink-0 transition-all duration-200">
      {/* Header bar */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="h-8 px-4 flex items-center justify-between cursor-pointer hover:bg-white/[0.02] text-xs text-gray-400 select-none"
      >
        <div className="flex items-center space-x-2">
          <Terminal className="w-3.5 h-3.5 text-blue-400" />
          <span className="font-medium text-gray-300">Session Logs</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white/5 font-mono">
            {logs.length}
          </span>
        </div>

        <div className="flex items-center space-x-2" onClick={(e) => e.stopPropagation()}>
          {isOpen && logs.length > 0 && (
            <>
              <button
                type="button"
                onClick={handleCopy}
                className="p-1 hover:text-white transition-colors"
                title="Copy Logs"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <button
                type="button"
                onClick={onClearLogs}
                className="p-1 hover:text-red-400 transition-colors"
                title="Clear Logs"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="p-1 hover:text-white"
          >
            {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Log body */}
      {isOpen && (
        <div className="h-44 p-3 overflow-y-auto font-mono text-[11px] leading-relaxed bg-black/40 text-gray-300 border-t border-white/5 space-y-0.5 select-text">
          {logs.length === 0 ? (
            <div className="text-gray-600 italic">No scrcpy session output logged yet...</div>
          ) : (
            logs.map((entry, index) => (
              <div key={index} className="whitespace-pre-wrap break-all text-gray-300">
                {entry.text}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
};
