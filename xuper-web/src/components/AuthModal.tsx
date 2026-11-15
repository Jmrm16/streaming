import React, { useState, useEffect } from 'react';
import { X, Mail, Lock, User, Eye, EyeOff, Loader2, LogIn, UserPlus, Sparkles } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { loginWithEmail, registerWithEmail, getFriendlyAuthError } from '../lib/firebase';

interface AuthModalProps {
  isOpen: boolean;
  initialMode?: 'login' | 'register';
  onClose: () => void;
  onSuccess: (message: string) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  initialMode = 'login',
  onClose,
  onSuccess,
}) => {
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setErrorMsg('');
      setPassword('');
    }
  }, [isOpen, initialMode]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setErrorMsg('Ingresa tu correo electrónico.');
      return;
    }
    if (password.length < 6) {
      setErrorMsg('La contraseña debe tener al menos 6 caracteres.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === 'login') {
        const cred = await loginWithEmail(trimmedEmail, password);
        const label = cred.user.displayName || cred.user.email || 'de nuevo';
        onSuccess(`¡Bienvenido, ${label}! Tu historial se ha sincronizado.`);
      } else {
        const cred = await registerWithEmail(trimmedEmail, password, displayName);
        const label = cred.user.displayName || cred.user.email || '';
        onSuccess(`Cuenta creada correctamente. ¡Bienvenido ${label}!`);
      }
      onClose();
    } catch (err) {
      setErrorMsg(getFriendlyAuthError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-[#181818] border border-zinc-800 rounded-xl overflow-hidden shadow-2xl p-6 space-y-5 animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-red-600/20 border border-red-600/40 flex items-center justify-center text-red-500">
              {mode === 'login' ? <LogIn className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">
                {mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
              </h2>
              <p className="text-[11px] text-zinc-400">
                Sincroniza tu historial y continúa viendo donde lo dejaste
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-300 hover:text-white transition-colors cursor-pointer"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Switch Tabs */}
        <div className="grid grid-cols-2 gap-1.5 p-1 bg-zinc-900 rounded-lg border border-zinc-800">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setErrorMsg('');
            }}
            className={`py-2 text-xs font-bold rounded-md transition-colors cursor-pointer ${
              mode === 'login'
                ? 'bg-red-600 text-white shadow'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            Ya tengo cuenta
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('register');
              setErrorMsg('');
            }}
            className={`py-2 text-xs font-bold rounded-md transition-colors cursor-pointer ${
              mode === 'register'
                ? 'bg-red-600 text-white shadow'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            Crear cuenta nueva
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-300 block">
                Nombre o apodo
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <Input
                  type="text"
                  placeholder="Ej. José"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={40}
                  className="pl-9 bg-black/60 border-zinc-700 text-white text-sm h-10"
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-zinc-300 block">
              Correo electrónico
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                type="email"
                autoComplete="email"
                required
                placeholder="tucorreo@ejemplo.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setErrorMsg('');
                }}
                className="pl-9 bg-black/60 border-zinc-700 text-white text-sm h-10"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-zinc-300 block">
              Contraseña
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                type={showPassword ? 'text' : 'password'}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                minLength={6}
                placeholder="Mínimo 6 caracteres"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErrorMsg('');
                }}
                className="pl-9 pr-10 bg-black/60 border-zinc-700 text-white text-sm h-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white p-1 cursor-pointer"
                tabIndex={-1}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-lg bg-red-950/60 border border-red-800/70 text-xs text-red-300 font-medium leading-relaxed">
              {errorMsg}
            </div>
          )}

          <div className="p-3 rounded-lg bg-zinc-900/80 border border-zinc-800/80 flex items-start gap-2.5 text-[11px] text-zinc-400 leading-relaxed">
            <Sparkles className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <span>
              Tu historial de películas, series vistas y el minuto exacto donde lo dejaste se guardarán automáticamente en la nube para retomarlos desde cualquier dispositivo.
            </span>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              className="text-zinc-400 hover:text-white text-xs cursor-pointer"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="bg-red-600 hover:bg-red-700 text-white font-bold text-xs px-5 h-10 cursor-pointer flex items-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Procesando...</span>
                </>
              ) : mode === 'login' ? (
                <>
                  <LogIn className="w-4 h-4" />
                  <span>Iniciar sesión</span>
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4" />
                  <span>Crear cuenta</span>
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AuthModal;
