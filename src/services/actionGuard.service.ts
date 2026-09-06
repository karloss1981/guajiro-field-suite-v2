// GUAJIRO V25 — Guard for destructive actions (route delete, restore, purge).
// Centralizes the check + the audit trail so every denial and every success
// is logged the same way, no matter which screen triggers the action.
import type { AuthState } from '../types/auth';
import { createAuditLog } from './audit.service';
import { describeSuperAdminGap, isSuperAdminSession } from './superAdminAuth.service';

export type DestructiveActionReasonCode = 'ok' | 'session_required' | 'not_super_admin';

export type DestructiveActionCheck = {
  allowed: boolean;
  reasonCode: DestructiveActionReasonCode;
  message: string;
};

export function checkDestructiveAction(auth: AuthState | null | undefined, lang: string = 'en'): DestructiveActionCheck {
  if (!auth) {
    return { allowed: false, reasonCode: 'session_required', message: describeSuperAdminGap(auth, lang) };
  }
  if (isSuperAdminSession(auth)) {
    return { allowed: true, reasonCode: 'ok', message: '' };
  }
  return {
    allowed: false,
    reasonCode: auth.authMode !== 'supabase' ? 'session_required' : 'not_super_admin',
    message: describeSuperAdminGap(auth, lang),
  };
}

export type GuardDestructiveActionInput = {
  auth: AuthState | null | undefined;
  lang?: string;
  action: string;
  entity: string;
  entityId?: string | number | null;
  metadata?: Record<string, unknown>;
};

/**
 * Runs the Super Admin check and, when it fails, writes a
 * "<action>_denied" audit log entry so every blocked attempt is traceable
 * even though nothing destructive happened. Callers should still avoid
 * exposing the confirm control at all when this returns allowed: false;
 * this function is the safety net + audit trail, not the only gate.
 */
export async function guardDestructiveAction(input: GuardDestructiveActionInput): Promise<DestructiveActionCheck> {
  const { auth, lang = 'en', action, entity, entityId = null, metadata = {} } = input;
  const result = checkDestructiveAction(auth, lang);
  if (!result.allowed) {
    await createAuditLog({
      action: `${action}_denied`,
      entity,
      entityId,
      metadata: {
        ...metadata,
        reasonCode: result.reasonCode,
        attemptedBy: auth?.user?.email || auth?.user?.name || auth?.tech?.name || 'unknown',
        summary: `${action} denied: ${result.reasonCode}`,
      },
    }).catch(() => {});
  }
  return result;
}

/**
 * Logs a successful destructive action. Kept symmetrical with
 * guardDestructiveAction so both halves of the audit trail (denied/success)
 * live in the same place and use the same action-name convention.
 */
export async function logDestructiveActionSuccess(input: GuardDestructiveActionInput): Promise<void> {
  const { auth, action, entity, entityId = null, metadata = {} } = input;
  await createAuditLog({
    action: `${action}_success`,
    entity,
    entityId,
    metadata: {
      ...metadata,
      actorEmail: auth?.user?.email || null,
      summary: `${action} completed`,
    },
  }).catch(() => {});
}
