import { sb } from '../config/supabase';

export async function verifyRoleSecurityPin(input: {
  role: 'admin' | 'supervisor' | 'viewer';
  region: string;
  pin: string;
}) {
  const { data, error } = await sb.rpc('verify_role_security_pin', {
    p_role: input.role,
    p_region: input.region,
    p_pin: input.pin,
  });
  if (error) throw error;
  return data === true;
}

export async function setRoleSecurityPin(input: {
  role: 'admin' | 'supervisor' | 'viewer';
  region: string;
  pin: string;
}) {
  const { data, error } = await sb.rpc('set_role_security_pin', {
    p_role: input.role,
    p_region: input.region,
    p_pin: input.pin,
  });
  if (error) throw error;
  return data === true;
}

export async function verifyTechnicianPin(technicianId: string, pin: string) {
  const { data, error } = await sb.rpc('verify_technician_pin', {
    p_technician_id: technicianId,
    p_pin: pin,
  });
  if (error) throw error;
  return data === true;
}

export async function adminSetTechnicianPin(technicianId: string, pin: string) {
  const { data, error } = await sb.rpc('admin_set_technician_pin', {
    p_technician_id: technicianId,
    p_pin: pin,
  });
  if (error) throw error;
  return data === true;
}

export async function reauthenticateWithPassword(password: string) {
  const { data: userData, error: userError } = await sb.auth.getUser();
  if (userError) throw userError;
  const email = userData.user?.email;
  if (!email) throw new Error('The authenticated account does not have an email address.');
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return true;
}


export async function changeOwnTechnicianPin(technicianId: string, currentPin: string, newPin: string) {
  const { data, error } = await sb.rpc('technician_change_own_pin', {
    p_technician_id: technicianId,
    p_current_pin: currentPin,
    p_new_pin: newPin,
  });
  if (error) throw error;
  return data === true;
}

export async function adminClearTechnicianPin(technicianId: string) {
  const { data, error } = await sb.rpc('admin_clear_technician_pin', {
    p_technician_id: technicianId,
  });
  if (error) throw error;
  return data === true;
}

export async function getSecurityRuntimeStatus() {
  const [userResult, sessionResult, legacyResult, adminEmailResult, techPinResult] = await Promise.allSettled([
    sb.auth.getUser(),
    sb.auth.getSession(),
    sb.rpc('is_legacy_access_enabled'),
    sb.rpc('is_admin_email_required'),
    sb.rpc('is_technician_pin_access_enabled'),
  ]);

  const getData = (result: PromiseSettledResult<any>) =>
    result.status === 'fulfilled' ? result.value?.data : null;
  const getError = (result: PromiseSettledResult<any>) =>
    result.status === 'rejected' ? result.reason?.message || String(result.reason) : result.value?.error?.message || null;

  return {
    userId: getData(userResult)?.user?.id || null,
    email: getData(userResult)?.user?.email || null,
    hasSession: Boolean(getData(sessionResult)?.session),
    legacyAccessEnabled: getData(legacyResult) === true,
    adminEmailRequired: getData(adminEmailResult) !== false,
    technicianPinAccessEnabled: getData(techPinResult) !== false,
    errors: [getError(userResult), getError(sessionResult), getError(legacyResult), getError(adminEmailResult), getError(techPinResult)].filter(Boolean),
  };
}
