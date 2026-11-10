import React, { useState } from 'react';
import { X, Server, Activity, Check, RefreshCw, Sparkles, ShieldCheck } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiUrl: string;
  onSaveApiUrl: (url: string) => void;
  isBackendOnline: boolean | null;
  onCheckBackend: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  apiUrl,
  onSaveApiUrl,
  isBackendOnline,
  onCheckBackend,
}) => {
  const [draftUrl, setDraftUrl] = useState(apiUrl);
  const [isSaved, setIsSaved] = useState(false);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveApiUrl(draftUrl.trim());
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-[#181818] border border-zinc-800 rounded-xl overflow-hidden shadow-2xl p-6 space-y-6 animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <Server className="w-5 h-5 text-red-600" />
            <h2 className="text-lg font-bold text-white">Configuración del Servidor</h2>
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
                  isBackendOnline ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'
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

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCheckBackend}
            className="w-full gap-2 text-xs border-zinc-700 bg-zinc-800/60 hover:bg-zinc-800 text-zinc-300"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Verificar Estado del Servidor</span>
          </Button>
        </div>

        {/* Form to change API URL */}
        <form onSubmit={handleSave} className="space-y-3">
          <label className="block text-xs font-semibold text-zinc-300">
            Dirección del Servidor Backend (API URL)
          </label>
          <div className="flex gap-2">
            <Input
              type="text"
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
              placeholder="https://streaming-qste.onrender.com"
              className="text-xs bg-black/70 border-zinc-800 text-zinc-100 font-mono"
            />
            <Button
              type="submit"
              className="bg-red-600 hover:bg-red-700 text-white font-bold text-xs px-4 cursor-pointer shrink-0"
            >
              {isSaved ? (
                <span className="flex items-center gap-1 text-emerald-300">
                  <Check className="w-3.5 h-3.5" /> Guardado
                </span>
              ) : (
                'Guardar'
              )}
            </Button>
          </div>
          <p className="text-[11px] text-zinc-500">
            Predeterminado: Servidor en la nube seguro de Render. También puedes usar{' '}
            <code className="text-zinc-400">http://127.0.0.1:8910</code> para desarrollo local.
          </p>
        </form>

        <div className="pt-2 flex justify-end">
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
