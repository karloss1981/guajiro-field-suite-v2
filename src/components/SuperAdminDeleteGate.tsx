// GUAJIRO V25 — Super Admin Delete Gate.
// Reusable confirmation gate for destructive, irreversible actions (route
// delete today; restore/purge can reuse it later). Enforces two things and
// nothing else can substitute for them:
//   1. An ACTIVE Super Admin session (Supabase email/password — never a PIN).
//   2. An exact, hand-typed confirmation phrase.
// Every open-while-blocked, deny, and confirm is written to the audit log
// through actionGuard.service.ts, so there is always a trail even when the
// action never actually ran.
import { useEffect, useMemo, useState } from 'react';
import type { AuthState } from '../types/auth';
import { C } from '../config/theme';
import { checkDestructiveAction, guardDestructiveAction } from '../services/actionGuard.service';

type SuperAdminDeleteGateProps = {
  open: boolean;
  auth: AuthState | null | undefined;
  lang: string;
  /** Audit action key, e.g. 'route_delete'. Denials log as `${action}_denied`. */
  action: string;
  /** Audit entity, e.g. 'route'. */
  entity: string;
  entityId?: string | number | null;
  metadata?: Record<string, unknown>;
  title?: string;
  description?: string;
  /** Confirmation phrase the user must type verbatim. Defaults to DELETE ROUTE. */
  expectedPhrase?: string;
  confirmLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

export default function SuperAdminDeleteGate({
  open,
  auth,
  lang,
  action,
  entity,
  entityId = null,
  metadata = {},
  title,
  description,
  expectedPhrase = 'DELETE ROUTE',
  confirmLabel,
  busy = false,
  onCancel,
  onConfirm,
}: SuperAdminDeleteGateProps) {
  const es = lang === 'es';
  const [phrase, setPhrase] = useState('');
  const [localError, setLocalError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const check = useMemo(() => checkDestructiveAction(auth, lang), [auth, lang]);

  useEffect(() => {
    if (!open) {
      setPhrase('');
      setLocalError('');
      return;
    }
    if (!check.allowed) {
      guardDestructiveAction({ auth, lang, action, entity, entityId, metadata }).catch(() => {});
    }
    // Only re-run when the gate opens/closes or the underlying auth changes —
    // not on every metadata object identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, check.allowed]);

  if (!open) return null;

  const phraseMatches = phrase.trim().toUpperCase() === expectedPhrase;

  const handleConfirm = async () => {
    if (!check.allowed || !phraseMatches) return;
    setConfirming(true);
    setLocalError('');
    try {
      await onConfirm();
    } catch (error: any) {
      setLocalError(error?.message || String(error));
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 930, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: C.card, border: `1px solid ${C.red}66`, borderRadius: 18, padding: 24, width: '100%', maxWidth: 420 }}>
        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 22, fontWeight: 900, color: C.red, marginBottom: 6 }}>
          🔒 {title || (es ? 'Se requiere Super Admin' : 'Super Admin required')}
        </div>
        <div style={{ fontSize: 12, color: C.dim, marginBottom: 16 }}>
          {description || (es ? 'Esta acción es destructiva y permanente.' : 'This action is destructive and permanent.')}
        </div>

        {!check.allowed ? (
          <>
            <div style={{ background: `${C.red}14`, border: `1px solid ${C.red}55`, borderRadius: 10, padding: '12px 14px', color: '#ff8a94', fontSize: 13, marginBottom: 16 }}>
              ⚠ {check.message}
            </div>
            <div style={{ fontSize: 11, color: C.dim, marginBottom: 16, lineHeight: 1.5 }}>
              {es
                ? 'No se acepta PIN para esta acción. Cierra sesión e ingresa con la cuenta Super Admin (correo/contraseña) para continuar.'
                : 'PIN access is never accepted for this action. Sign out and sign in with the Super Admin account (email/password) to continue.'}
            </div>
            <button
              onClick={onCancel}
              style={{ width: '100%', background: 'none', border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, color: C.dim, cursor: 'pointer', fontWeight: 700 }}
            >
              {es ? 'Cerrar' : 'Close'}
            </button>
          </>
        ) : (
          <>
            <div style={{ background: `${C.green}14`, border: `1px solid ${C.green}55`, borderRadius: 10, padding: '10px 12px', color: '#4fe3a8', fontSize: 11, marginBottom: 14 }}>
              ✓ {es ? 'Sesión Super Admin activa' : 'Active Super Admin session'}{auth?.user?.email ? ` — ${auth.user.email}` : ''}
            </div>
            <label style={{ fontSize: 11, color: C.dim, display: 'block', marginBottom: 4 }}>
              {es ? `Escribe ${expectedPhrase} para confirmar` : `Type ${expectedPhrase} to confirm`}
            </label>
            <input
              value={phrase}
              onChange={(e) => { setPhrase(e.target.value.toUpperCase()); setLocalError(''); }}
              placeholder={expectedPhrase}
              autoFocus
              style={{ width: '100%', background: '#071327', border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', color: C.text, fontSize: 14, marginBottom: localError ? 8 : 16, outline: 'none', letterSpacing: 1 }}
            />
            {localError && <div style={{ color: '#ff6677', fontSize: 12, marginBottom: 12 }}>⚠ {localError}</div>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={onCancel}
                disabled={confirming || busy}
                style={{ flex: 1, background: 'none', border: `1px solid ${C.border}`, borderRadius: 10, padding: 11, color: C.dim, cursor: 'pointer', fontWeight: 700 }}
              >
                {es ? 'Cancelar' : 'Cancel'}
              </button>
              <button
                onClick={handleConfirm}
                disabled={confirming || busy || !phraseMatches}
                style={{ flex: 1, background: 'linear-gradient(135deg,#c81e3a,#ff3348)', border: 'none', borderRadius: 10, padding: 11, color: '#fff', cursor: 'pointer', fontWeight: 900, opacity: confirming || busy || !phraseMatches ? 0.5 : 1 }}
              >
                {confirming || busy ? (es ? 'Procesando…' : 'Processing…') : confirmLabel || (es ? 'Confirmar borrado' : 'Confirm delete')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
