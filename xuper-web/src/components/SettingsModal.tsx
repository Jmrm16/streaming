import React, { useState, useEffect } from 'react';
import { X, Server, RefreshCw, ShieldCheck, Lock, EyeOff, Eye, KeyRound, Check } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiUrl?: string;
  onSaveApiUrl?: (url: string) => void;
  isBackendOnline: boolean | null;
  onCheckBackend: () => void;
  adultPin?: string;
  onUpdateAdultPin?: (newPin: string) => void;
  hideAdultCategory?: boolean;
  onToggleHideAdultCategory?: (hide: boolean) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  isBackendOnline,
  onCheckBackend,
  adultPin = '1234',
  onUpdateAdultPin,
  hideAdultCategory = false,
  onToggleHideAdultCategory,
}) => {
  const [isParentalAuthorized, setIsParentalAuthorized] = useState(false);
  const [verifyPinInput, setVerifyPinInput] = useState('');
  const [newPinInput, setNewPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinSuccess, setPinSuccess] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setIsParentalAuthorized(false);
      setVerifyPinInput('');
      setNewPinInput('');
      setPinError('');
      setPinSuccess('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleUnlockParentalSettings = (e: React.FormEvent) => {
    e.preventDefault();
    if (verifyPinInput.trim() === adultPin) {
      setIsParentalAuthorized(true);
      setPinError('');
      setVerifyPinInput('');
    } else {
      setPinError('PIN incorrecto.');
    }
  };

  const handleSaveNewPin = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = newPinInput.replace(/\D/g, '').slice(0, 4);
    if (cleaned.length !== 4) {
      setPinError('El PIN debe tener exactamente 4 dígitos numéricos.');
      setPinSuccess('');
      return;
    }
    if (onUpdateAdultPin) {
      onUpdateAdultPin(cleaned);
    }
    setNewPinInput('');
    setPinError('');
    setPinSuccess('PIN de Control Parental actualizado correctamente.');
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-[#181818] border border-zinc-800 rounded-xl overflow-hidden shadow-2xl p-6 space-y-5 animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <Server className="w-5 h-5 text-red-600" />
            <h2 className="text-lg font-bold text-white">Configuración y Seguridad</h2>
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

        {/* Control Parental (+18) Card */}
        <div className="p-4 rounded-lg bg-zinc-900/80 border border-zinc-800/80 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-amber-500" />
              <span className="text-xs uppercase tracking-wider font-semibold text-zinc-200">
                Control Parental (+18 en TV en Vivo)
              </span>
            </div>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-950/60 text-amber-400 border border-amber-800/60">
              Protegido con PIN
            </span>
          </div>

          {!isParentalAuthorized ? (
            <form onSubmit={handleUnlockParentalSettings} className="space-y-2.5 pt-1">
              <p className="text-xs text-zinc-400">
                Ingresa tu PIN actual de 4 dígitos para configurar el bloqueo o cambiar la clave de acceso a la sección +18:
              </p>
              <div className="flex items-center gap-2">
                <Input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="PIN (4 dígitos)"
                  value={verifyPinInput}
                  onChange={(e) => {
                    setVerifyPinInput(e.target.value.replace(/\D/g, '').slice(0, 4));
                    setPinError('');
                  }}
                  className="bg-black/60 border-zinc-700 text-white text-center tracking-[0.4em] font-mono h-9 text-sm"
                />
                <Button
                  type="submit"
                  size="sm"
                  className="bg-amber-600 hover:bg-amber-500 text-black font-bold text-xs h-9 px-4 cursor-pointer shrink-0"
                >
                  Desbloquear
                </Button>
              </div>
              {pinError && <p className="text-xs text-red-400 font-medium">{pinError}</p>}
            </form>
          ) : (
            <div className="space-y-3.5 pt-1">
              {/* Toggle Hide +18 Completely */}
              <div className="flex items-center justify-between gap-3 p-2.5 rounded bg-black/40 border border-zinc-800/70">
                <div className="space-y-0.5">
                  <span className="text-xs font-semibold text-zinc-200 block">
                    Ocultar botón 18+ en TV en Vivo
                  </span>
                  <span className="text-[11px] text-zinc-400 block">
                    {hideAdultCategory
                      ? 'La categoría 18+ está totalmente oculta.'
                      : 'La categoría 18+ es visible pero pide PIN al abrir.'}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    onToggleHideAdultCategory && onToggleHideAdultCategory(!hideAdultCategory)
                  }
                  className={`gap-1.5 text-xs h-8 px-3 cursor-pointer shrink-0 ${
                    hideAdultCategory
                      ? 'border-red-700/80 bg-red-950/50 text-red-300 hover:bg-red-900/50'
                      : 'border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
                  }`}
                >
                  {hideAdultCategory ? (
                    <>
                      <EyeOff className="w-3.5 h-3.5" />
                      <span>Oculto</span>
                    </>
                  ) : (
                    <>
                      <Eye className="w-3.5 h-3.5" />
                      <span>Con PIN</span>
                    </>
                  )}
                </Button>
              </div>

              {/* Change 4-digit PIN */}
              <form onSubmit={handleSaveNewPin} className="space-y-2">
                <label className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                  <span>Cambiar PIN de seguridad (4 dígitos)</span>
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="Nuevo PIN (ej. 2580)"
                    value={newPinInput}
                    onChange={(e) => {
                      setNewPinInput(e.target.value.replace(/\D/g, '').slice(0, 4));
                      setPinError('');
                      setPinSuccess('');
                    }}
                    className="bg-black/60 border-zinc-700 text-white text-center tracking-[0.4em] font-mono h-9 text-sm"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    className="bg-white hover:bg-zinc-200 text-black font-bold text-xs h-9 px-4 cursor-pointer shrink-0"
                  >
                    Guardar PIN
                  </Button>
                </div>
                {pinError && <p className="text-xs text-red-400 font-medium">{pinError}</p>}
                {pinSuccess && (
                  <p className="text-xs text-emerald-400 font-medium flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" />
                    <span>{pinSuccess}</span>
                  </p>
                )}
              </form>
            </div>
          )}
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
