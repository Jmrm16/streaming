import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Mail,
  Lock,
  User,
  Eye,
  EyeOff,
  Loader2,
  LogIn,
  UserPlus,
  Sparkles,
  MailCheck,
  RefreshCw,
  CheckCircle2,
  ArrowLeft,
} from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import {
  loginWithEmail,
  registerWithEmail,
  logoutUser,
  resendVerificationEmail,
  verifyEmailStatus,
  sendPasswordReset,
  getFriendlyAuthError,
} from '../lib/firebase';

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
  const [view, setView] = useState<'login' | 'register' | 'verify'>(initialMode);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (isOpen) {
      setView(initialMode);
      setErrorMsg('');
      setInfoMsg('');
      setPassword('');
      setResendCooldown(0);
    }
  }, [isOpen, initialMode]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const handleClose = useCallback(() => {
    if (view === 'verify') {
      logoutUser().catch(() => {});
    }
    onClose();
  }, [view, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');

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
      if (view === 'login') {
        const cred = await loginWithEmail(trimmedEmail, password);
        if (!cred.user.emailVerified) {
          setView('verify');
          setInfoMsg(
            'Tu cuenta aún no ha sido verificada. Confirma el enlace que enviamos a tu correo o solicita uno nuevo abajo.'
          );
          return;
        }
        const label = cred.user.displayName || cred.user.email || 'de nuevo';
        onSuccess(`¡Bienvenido, ${label}! Tu historial se ha sincronizado.`);
        onClose();
      } else {
        await registerWithEmail(trimmedEmail, password, displayName);
        setView('verify');
        setResendCooldown(60);
        setInfoMsg(
          `Te enviamos un enlace de verificación a ${trimmedEmail}. Revisa tu bandeja de entrada o la carpeta de Spam.`
        );
      }
    } catch (err) {
      setErrorMsg(getFriendlyAuthError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCheckVerified = async () => {
    setErrorMsg('');
    setInfoMsg('');
    setIsSubmitting(true);
    try {
      const { verified, user } = await verifyEmailStatus(email.trim(), password);
      if (verified) {
        const label = user?.displayName || user?.email || email.trim();
        onSuccess(`¡Correo verificado con éxito! Bienvenido, ${label}.`);
        onClose();
      } else {
        setErrorMsg(
          'Aún no detectamos la verificación. Abre el correo que te enviamos, haz clic en el enlace de confirmación y vuelve a pulsar este botón.'
        );
      }
    } catch (err) {
      setErrorMsg(getFriendlyAuthError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendVerification = async () => {
    if (resendCooldown > 0 || isSubmitting) return;
    setErrorMsg('');
    setInfoMsg('');
    setIsSubmitting(true);
    try {
      const { alreadyVerified } = await resendVerificationEmail(email.trim(), password);
      if (alreadyVerified) {
        onSuccess('¡Tu correo ya estaba verificado! Sesión iniciada.');
        onClose();
        return;
      }
      setResendCooldown(60);
      setInfoMsg(
        `Hemos enviado un nuevo enlace de verificación a ${email.trim()}. Revisa tu bandeja o la carpeta de Spam.`
      );
    } catch (err) {
      setErrorMsg(getFriendlyAuthError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgotPassword = async () => {
    setErrorMsg('');
    setInfoMsg('');
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setErrorMsg('Ingresa primero tu correo electrónico para enviarte el enlace de recuperación.');
      return;
    }
    setIsSubmitting(true);
    try {
      await sendPasswordReset(trimmedEmail);
      setInfoMsg(
        `Te enviamos un correo a ${trimmedEmail} para restablecer tu contraseña. Revisa también tu carpeta de Spam.`
      );
    } catch (err) {
      setErrorMsg(getFriendlyAuthError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-md bg-[#181818] border border-zinc-800 rounded-xl overflow-hidden shadow-2xl p-6 space-y-5 animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-red-600/20 border border-red-600/40 flex items-center justify-center text-red-500">
              {view === 'verify' ? (
                <MailCheck className="w-4 h-4" />
              ) : view === 'login' ? (
                <LogIn className="w-4 h-4" />
              ) : (
                <UserPlus className="w-4 h-4" />
              )}
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">
                {view === 'verify'
                  ? 'Verifica tu correo'
                  : view === 'login'
                  ? 'Iniciar sesión'
                  : 'Crear cuenta'}
              </h2>
              <p className="text-[11px] text-zinc-400">
                {view === 'verify'
                  ? 'Confirma tu dirección para activar la sincronización'
                  : 'Sincroniza tu historial y continúa viendo donde lo dejaste'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-300 hover:text-white transition-colors cursor-pointer"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {view === 'verify' ? (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-zinc-900/90 border border-zinc-800 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-white">
                <Mail className="w-4 h-4 text-red-500 shrink-0" />
                <span className="truncate">{email.trim()}</span>
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed">
                Haz clic en el enlace de confirmación que enviamos a tu correo electrónico para activar tu cuenta. Si no lo ves en tu bandeja principal, revisa la carpeta de{' '}
                <span className="font-semibold text-white">Spam / Correo no deseado</span>.
              </p>
            </div>

            {infoMsg && (
              <div className="p-3 rounded-lg bg-emerald-950/50 border border-emerald-800/70 text-xs text-emerald-300 font-medium leading-relaxed">
                {infoMsg}
              </div>
            )}

            {errorMsg && (
              <div className="p-3 rounded-lg bg-red-950/60 border border-red-800/70 text-xs text-red-300 font-medium leading-relaxed">
                {errorMsg}
              </div>
            )}

            <div className="space-y-2.5 pt-1">
              <Button
                type="button"
                disabled={isSubmitting}
                onClick={handleCheckVerified}
                className="w-full bg-red-600 hover:bg-red-700 text-white font-bold text-xs h-10 cursor-pointer flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Comprobando...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Ya verifiqué mi correo — Entrar</span>
                  </>
                )}
              </Button>

              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting || resendCooldown > 0}
                onClick={handleResendVerification}
                className="w-full border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 text-xs h-9 cursor-pointer flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>
                  {resendCooldown > 0
                    ? `Reenviar correo en ${resendCooldown}s`
                    : 'Reenviar correo de verificación'}
                </span>
              </Button>

              <button
                type="button"
                onClick={() => {
                  logoutUser().catch(() => {});
                  setView('login');
                  setErrorMsg('');
                  setInfoMsg('');
                }}
                className="w-full py-2 text-xs text-zinc-400 hover:text-white flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Volver / Usar otro correo</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Mode Switch Tabs */}
            <div className="grid grid-cols-2 gap-1.5 p-1 bg-zinc-900 rounded-lg border border-zinc-800">
              <button
                type="button"
                onClick={() => {
                  setView('login');
                  setErrorMsg('');
                  setInfoMsg('');
                }}
                className={`py-2 text-xs font-bold rounded-md transition-colors cursor-pointer ${
                  view === 'login'
                    ? 'bg-red-600 text-white shadow'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Ya tengo cuenta
              </button>
              <button
                type="button"
                onClick={() => {
                  setView('register');
                  setErrorMsg('');
                  setInfoMsg('');
                }}
                className={`py-2 text-xs font-bold rounded-md transition-colors cursor-pointer ${
                  view === 'register'
                    ? 'bg-red-600 text-white shadow'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Crear cuenta nueva
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              {view === 'register' && (
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
                      setInfoMsg('');
                    }}
                    className="pl-9 bg-black/60 border-zinc-700 text-white text-sm h-10"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-zinc-300 block">
                    Contraseña
                  </label>
                  {view === 'login' && (
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={handleForgotPassword}
                      className="text-[11px] text-zinc-400 hover:text-white underline cursor-pointer"
                    >
                      ¿Olvidaste tu contraseña?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={view === 'login' ? 'current-password' : 'new-password'}
                    required
                    minLength={6}
                    placeholder="Mínimo 6 caracteres"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setErrorMsg('');
                      setInfoMsg('');
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

              {infoMsg && (
                <div className="p-3 rounded-lg bg-emerald-950/50 border border-emerald-800/70 text-xs text-emerald-300 font-medium leading-relaxed">
                  {infoMsg}
                </div>
              )}

              {errorMsg && (
                <div className="p-3 rounded-lg bg-red-950/60 border border-red-800/70 text-xs text-red-300 font-medium leading-relaxed">
                  {errorMsg}
                </div>
              )}

              <div className="p-3 rounded-lg bg-zinc-900/80 border border-zinc-800/80 flex items-start gap-2.5 text-[11px] text-zinc-400 leading-relaxed">
                <Sparkles className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <span>
                  {view === 'register'
                    ? 'Te enviaremos un enlace de verificación a tu correo para activar tu cuenta y sincronizar tu historial en la nube.'
                    : 'Tu historial de películas, series vistas y el minuto exacto donde lo dejaste se guardarán automáticamente en la nube para retomarlos desde cualquier dispositivo.'}
                </span>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleClose}
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
                  ) : view === 'login' ? (
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
          </>
        )}
      </div>
    </div>
  );
};

export default AuthModal;
