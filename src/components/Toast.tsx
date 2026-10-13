import React from 'react';
import { AlertCircle, CheckCircle, Info, X } from 'lucide-react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

interface ToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const Toast: React.FC<ToastProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-14 right-5 z-50 flex flex-col space-y-2 pointer-events-none">
      {toasts.map((toast) => {
        const isSuccess = toast.type === 'success';
        const isError = toast.type === 'error';

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-center space-x-2.5 px-4 py-2.5 rounded-xl border shadow-xl text-xs backdrop-blur-md animate-in fade-in slide-in-from-top-3 duration-200 ${
              isSuccess
                ? 'bg-emerald-950/80 border-emerald-500/40 text-emerald-200'
                : isError
                ? 'bg-red-950/80 border-red-500/40 text-red-200'
                : 'bg-blue-950/80 border-blue-500/40 text-blue-200'
            }`}
          >
            {isSuccess ? (
              <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : isError ? (
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            ) : (
              <Info className="w-4 h-4 text-blue-400 shrink-0" />
            )}

            <span className="font-medium">{toast.message}</span>

            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className="p-1 hover:opacity-75 transition-opacity ml-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
