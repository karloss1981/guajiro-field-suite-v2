import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const allowedRoles = new Set(['super_admin','admin','supervisor','dispatcher','technician','viewer']);
const allowedRegions = new Set(['miami','swfl']);

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !anonKey || !serviceRoleKey) throw new Error('Supabase function secrets are not configured.');

    const authorization = request.headers.get('Authorization');
    if (!authorization) return json({ error: 'Authentication required.' }, 401);

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerData.user) return json({ error: 'Invalid authenticated session.' }, 401);

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: callerRoles, error: roleError } = await serviceClient
      .from('user_roles')
      .select('roles(name)')
      .eq('user_id', callerData.user.id);
    if (roleError) throw roleError;
    const callerRoleNames = (callerRoles || []).map((row: any) => row.roles?.name).filter(Boolean);
    const isAdmin = callerRoleNames.some((name: string) => ['super_admin','admin'].includes(name));
    const isSuperAdmin = callerRoleNames.includes('super_admin');
    if (!isAdmin) return json({ error: 'Admin role required.' }, 403);

    const body = await request.json();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const displayName = String(body.display_name || '').trim();
    const role = String(body.role || 'viewer');
    const region = String(body.region || 'miami');
    const technicianId = body.technician_id ? String(body.technician_id) : null;

    if (!email || !email.includes('@')) return json({ error: 'A valid email is required.' }, 400);
    if (password.length < 8) return json({ error: 'Password must contain at least 8 characters.' }, 400);
    if (!displayName) return json({ error: 'Display name is required.' }, 400);
    if (!allowedRoles.has(role)) return json({ error: 'Unsupported application role.' }, 400);
    if (role === 'super_admin' && !isSuperAdmin) return json({ error: 'Only a Super Admin can create another Super Admin.' }, 403);
    if (!allowedRegions.has(region)) return json({ error: 'Unsupported region.' }, 400);
    if (role === 'technician' && !technicianId) return json({ error: 'Technician role requires a technician number.' }, 400);

    if (technicianId) {
      const { data: technician } = await serviceClient.from('technicians').select('id').eq('id', technicianId).maybeSingle();
      if (!technician) return json({ error: 'The selected technician number does not exist.' }, 400);
    }

    const { data: created, error: createError } = await serviceClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: displayName, region, technician_id: technicianId },
    });
    if (createError) throw createError;
    if (!created.user) throw new Error('Supabase did not create the account.');

    const { data: roleRecord, error: roleLookupError } = await serviceClient.from('roles').select('id').eq('name', role).single();
    if (roleLookupError) throw roleLookupError;

    const { error: profileError } = await serviceClient.from('user_profiles').upsert({
      user_id: created.user.id,
      display_name: displayName,
      region,
      technician_id: role === 'technician' ? technicianId : null,
      active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (profileError) throw profileError;

    const { error: roleInsertError } = await serviceClient.from('user_roles').upsert({
      user_id: created.user.id,
      role_id: roleRecord.id,
    }, { onConflict: 'user_id,role_id' });
    if (roleInsertError) throw roleInsertError;

    await serviceClient.from('audit_logs').insert({
      user_id: callerData.user.id,
      action: 'secure_user_created',
      entity: 'user_profile',
      entity_id: created.user.id,
      metadata: { email, role, region, technician_id: technicianId, created_by: callerData.user.id },
    });

    return json({ user_id: created.user.id, email });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
