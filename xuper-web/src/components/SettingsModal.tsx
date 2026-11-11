import React from 'react';
import { X, Server, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from './ui/button';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiUrl?: string;
  onSaveApiUrl?: (url: string) => void;
  isBackendOnline: boolean | null;
  onCheckBackend: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  isBackendOnline,
  onCheckBackend,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-[#181818] border border-zinc-800 rounded-xl overflow-hidden shadow-2xl p-6 space-y-5 animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <Server className="w-5 h-5 text-red-600" />
            <h2 className="text-lg font-bold text-white">Estado del Servicio</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-300 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Server Status Card */}
        <div className="p-4 rounded-lg bg-zinc-900/80 border border-zinc-800/80 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider font-semibold text-zinc-400">
              Estado de la Conexión
            </span>
            <div className="flex items-center gap-2">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  isBackendOnline ? 'bg-emerald-500' : 'bg-red-500'
                }`}
              />
              <span
                className={`text-xs font-bold ${
                  isBackendOnline ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {isBackendOnline ? 'En línea • Activo' : 'Desconectado'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs pt-1">
            <div className="p-2.5 bg-black/40 rounded border border-zinc-800/60">
              <span className="text-zinc-500 block text-[10px]">PROTOCOLO</span>
              <span className="font-semibold text-zinc-200">HLS • MPEG-TS</span>
            </div>
            <div className="p-2.5 bg-black/40 rounded border border-zinc-800/60">
              <span className="text-zinc-500 block text-[10px]">RESOLUCIÓN</span>
              <span className="font-semibold text-zinc-200">1080p / 4K UHD</span>
            </div>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-zinc-400 pt-1">
            <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>Conexión cifrada de alta velocidad activa para MAICAOFLIX.</span>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCheckBackend}
            className="w-full gap-2 text-xs border-zinc-700 bg-zinc-800/60 hover:bg-zinc-800 text-zinc-300 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Verificar Estado del Servicio</span>
          </Button>
        </div>

        <div className="pt-1 flex justify-end">
          <Button
            type="button"
            onClick={onClose}
            className="bg-white text-black hover:bg-zinc-200 font-semibold text-xs px-5 cursor-pointer"
          >
            Cerrar
          </Button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
