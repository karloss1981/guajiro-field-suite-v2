// ============================================================================
// ADMIN CONSOLE — Técnicos & Roles (V26.2)
// Página dentro de Herramientas, visible SOLO para Super Admin.
// Pestaña Técnicos: CRUD sobre tabla `technicians`.
//   - Agregar, editar (name, region, active, specialties, pin), buscar.
//   - "Borrar" = desactivar (active=false, recuperable) por defecto.
//   - Borrado PERMANENTE = paso extra con confirmación por frase.
// Pestaña Roles: pendiente de confirmar esquema (roles / user_roles).
// Archivo autónomo. NO toca ningún otro componente.
// ============================================================================
import { useEffect, useMemo, useState, useCallback } from 'react';
import { sb } from '../../../config/supabase';
import { isSuperAdminSession } from '../../../services/superAdminAuth.service';

const C = {
  bg: '#0b1830', card: '#0e1e3a', border: '#162e58', text: '#e6eefc',
  dim: '#8aa0c8', cyan: '#00b8f5', green: '#00dc85', red: '#ff3348',
  amber: '#ffbe00', purple: '#9d5fff', orange: '#ff6a1a',
};

const DELETE_PHRASE = 'BORRAR PERMANENTE';

type Tech = {
  id: string; name: string; pin?: string | null; region?: string | null;
  active?: boolean | null; specialties?: string[] | null;
  gps_consent?: boolean | null;
};

function Btn({ onClick, children, color = C.cyan, disabled = false, small = false }: any) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: color + '22', border: '1px solid ' + color, borderRadius: 9,
      padding: small ? '5px 10px' : '9px 14px', color, fontWeight: 700,
      fontSize: small ? 11 : 12, cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
    }}>{children}</button>
  );
}

const inputStyle: any = {
  background: C.bg, border: '1px solid ' + C.border, borderRadius: 8,
  padding: '8px 10px', color: C.text, fontSize: 13, width: '100%', boxSizing: 'border-box',
};

// ---------------------------------------------------------------------------
// Pestaña TÉCNICOS
// ---------------------------------------------------------------------------
function TechniciansTab({ lang }: { lang: string }) {
  const es = lang === 'es';
  const [rows, setRows] = useState<Tech[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [form, setForm] = useState<Tech | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [msg, setMsg] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<Tech | null>(null);
  const [phrase, setPhrase] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await sb.from('technicians').select('*').order('id');
      setRows((data as Tech[]) || []);
    } catch { setRows([]); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter(r => {
      if (!showInactive && r.active === false) return false;
      if (!term) return true;
      return [r.id, r.name, r.region, (r.specialties || []).join(' ')]
        .some(v => String(v || '').toLowerCase().includes(term));
    });
  }, [rows, search, showInactive]);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3500); };

  // Guardar edición o alta
  const save = async (t: Tech, isNew: boolean) => {
    if (!t.id || !t.name) { flash(es ? 'ID y nombre son obligatorios.' : 'ID and name are required.'); return; }
    const payload: any = {
      id: t.id.trim(),
      name: t.name.trim(),
      region: (t.region || '').trim() || null,
      active: t.active !== false,
      specialties: Array.isArray(t.specialties) ? t.specialties : [],
    };
    if (t.pin && String(t.pin).trim()) payload.pin = String(t.pin).trim();
    try {
      if (isNew) {
        const { error } = await sb.from('technicians').insert(payload);
        if (error) { flash((es ? 'Error: ' : 'Error: ') + error.message); return; }
        flash(es ? 'Técnico agregado.' : 'Technician added.');
      } else {
        const { error } = await sb.from('technicians').update(payload).eq('id', t.id);
        if (error) { flash((es ? 'Error: ' : 'Error: ') + error.message); return; }
        flash(es ? 'Cambios guardados.' : 'Changes saved.');
      }
      setForm(null); setIsNew(false); load();
    } catch (e: any) { flash((es ? 'Error: ' : 'Error: ') + (e?.message || e)); }
  };

  // Desactivar (recuperable)
  const deactivate = async (t: Tech) => {
    try {
      const { error } = await sb.from('technicians').update({ active: false }).eq('id', t.id);
      if (error) { flash((es ? 'Error: ' : 'Error: ') + error.message); return; }
      flash(es ? 'Técnico desactivado (recuperable).' : 'Technician deactivated (recoverable).');
      load();
    } catch (e: any) { flash((es ? 'Error: ' : 'Error: ') + (e?.message || e)); }
  };

  // Reactivar
  const reactivate = async (t: Tech) => {
    try {
      await sb.from('technicians').update({ active: true }).eq('id', t.id);
      flash(es ? 'Técnico reactivado.' : 'Technician reactivated.');
      load();
    } catch (e: any) { flash((es ? 'Error: ' : 'Error: ') + (e?.message || e)); }
  };

  // Borrado PERMANENTE (con frase)
  const deletePermanent = async () => {
    if (!confirmDelete) return;
    if (phrase.trim() !== DELETE_PHRASE) { flash(es ? 'Frase incorrecta.' : 'Wrong phrase.'); return; }
    try {
      const { error } = await sb.from('technicians').delete().eq('id', confirmDelete.id);
      if (error) { flash((es ? 'Error: ' : 'Error: ') + error.message); return; }
      flash(es ? 'Técnico borrado permanentemente.' : 'Technician permanently deleted.');
      setConfirmDelete(null); setPhrase(''); load();
    } catch (e: any) { flash((es ? 'Error: ' : 'Error: ') + (e?.message || e)); }
  };

  return (
    <div>
      {/* Controles */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder={es ? 'Buscar por ID, nombre, región…' : 'Search by ID, name, region…'}
          style={{ ...inputStyle, maxWidth: 320 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.dim, fontSize: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
          {es ? 'Ver inactivos' : 'Show inactive'}
        </label>
        <div style={{ flex: 1 }} />
        <Btn onClick={load} color={C.dim}>{loading ? '…' : (es ? '↻ Actualizar' : '↻ Refresh')}</Btn>
        <Btn onClick={() => { setForm({ id: '', name: '', region: 'miami', active: true, specialties: [] }); setIsNew(true); }} color={C.green}>+ {es ? 'Agregar técnico' : 'Add technician'}</Btn>
      </div>

      {msg && <div style={{ background: C.card, border: '1px solid ' + C.cyan + '55', borderRadius: 9, padding: '8px 12px', color: C.text, fontSize: 12, marginBottom: 10 }}>{msg}</div>}

      {/* Formulario alta/edición */}
      {form && (
        <div style={{ background: C.card, border: '1px solid ' + C.cyan + '55', borderRadius: 12, padding: 16, marginBottom: 14 }}>
          <div style={{ fontWeight: 800, color: C.cyan, marginBottom: 10 }}>
            {isNew ? (es ? 'Nuevo técnico' : 'New technician') : (es ? 'Editar ' : 'Edit ') + form.id}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}>
            <div>
              <div style={{ fontSize: 10, color: C.dim, marginBottom: 3 }}>ID {isNew ? '' : (es ? '(no editable)' : '(locked)')}</div>
              <input value={form.id} disabled={!isNew} onChange={e => setForm({ ...form, id: e.target.value })} style={{ ...inputStyle, opacity: isNew ? 1 : 0.6 }} />
            </div>
            <div>
              <div style={{ fontSize: 10, color: C.dim, marginBottom: 3 }}>{es ? 'Nombre' : 'Name'}</div>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={inputStyle} />
            </div>
            <div>
              <div style={{ fontSize: 10, color: C.dim, marginBottom: 3 }}>{es ? 'Región' : 'Region'}</div>
              <select value={form.region || 'miami'} onChange={e => setForm({ ...form, region: e.target.value })} style={inputStyle}>
                <option value="miami">miami</option>
                <option value="swfl">swfl</option>
                <option value="broward">broward</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: 10, color: C.dim, marginBottom: 3 }}>PIN {es ? '(dejar vacío = no cambia)' : '(blank = keep)'}</div>
              <input value={form.pin || ''} onChange={e => setForm({ ...form, pin: e.target.value })} style={inputStyle} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={{ fontSize: 10, color: C.dim, marginBottom: 3 }}>{es ? 'Especialidades (separadas por coma)' : 'Specialties (comma-separated)'}</div>
              <input value={(form.specialties || []).join(', ')} onChange={e => setForm({ ...form, specialties: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} style={inputStyle} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.text, fontSize: 13 }}>
              <input type="checkbox" checked={form.active !== false} onChange={e => setForm({ ...form, active: e.target.checked })} />
              {es ? 'Activo' : 'Active'}
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <Btn onClick={() => save(form, isNew)} color={C.green}>{es ? 'Guardar' : 'Save'}</Btn>
            <Btn onClick={() => { setForm(null); setIsNew(false); }} color={C.dim}>{es ? 'Cancelar' : 'Cancel'}</Btn>
          </div>
        </div>
      )}

      {/* Tabla */}
      {loading ? (
        <div style={{ color: C.dim, padding: 20 }}>{es ? 'Cargando…' : 'Loading…'}</div>
      ) : visible.length === 0 ? (
        <div style={{ color: C.dim, padding: 20 }}>{es ? 'No hay técnicos.' : 'No technicians.'}</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: C.dim, textAlign: 'left' }}>
                <th style={{ padding: 8, borderBottom: '1px solid ' + C.border }}>ID</th>
                <th style={{ padding: 8, borderBottom: '1px solid ' + C.border }}>{es ? 'Nombre' : 'Name'}</th>
                <th style={{ padding: 8, borderBottom: '1px solid ' + C.border }}>{es ? 'Región' : 'Region'}</th>
                <th style={{ padding: 8, borderBottom: '1px solid ' + C.border }}>{es ? 'Estado' : 'Status'}</th>
                <th style={{ padding: 8, borderBottom: '1px solid ' + C.border }}>{es ? 'Acciones' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(r => {
                const active = r.active !== false;
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid ' + C.border + '55', opacity: active ? 1 : 0.5 }}>
                    <td style={{ padding: 8, color: C.purple, fontWeight: 700 }}>{r.id}</td>
                    <td style={{ padding: 8, color: C.text }}>{r.name}</td>
                    <td style={{ padding: 8, color: C.dim }}>{r.region || '—'}</td>
                    <td style={{ padding: 8 }}>
                      <span style={{ color: active ? C.green : C.red, fontSize: 12, fontWeight: 700 }}>
                        {active ? (es ? 'Activo' : 'Active') : (es ? 'Inactivo' : 'Inactive')}
                      </span>
                    </td>
                    <td style={{ padding: 8 }}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <Btn small onClick={() => { setForm({ ...r, pin: '' }); setIsNew(false); }} color={C.cyan}>{es ? 'Editar' : 'Edit'}</Btn>
                        {active
                          ? <Btn small onClick={() => deactivate(r)} color={C.amber}>{es ? 'Desactivar' : 'Deactivate'}</Btn>
                          : <Btn small onClick={() => reactivate(r)} color={C.green}>{es ? 'Reactivar' : 'Reactivate'}</Btn>}
                        <Btn small onClick={() => { setConfirmDelete(r); setPhrase(''); }} color={C.red}>{es ? 'Borrar' : 'Delete'}</Btn>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal de borrado permanente */}
      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', zIndex: 950, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}>
          <div style={{ width: '100%', maxWidth: 460, background: C.bg, border: '1px solid ' + C.red, borderRadius: 16, padding: 22 }}>
            <div style={{ fontSize: 20, fontWeight: 900, color: C.red, marginBottom: 8 }}>⚠️ {es ? 'Borrado permanente' : 'Permanent delete'}</div>
            <div style={{ color: C.text, fontSize: 13, marginBottom: 6 }}>
              {es ? 'Vas a borrar de forma PERMANENTE a ' : 'You are about to PERMANENTLY delete '}
              <b>{confirmDelete.name} (#{confirmDelete.id})</b>. {es ? 'Esto no se puede deshacer.' : 'This cannot be undone.'}
            </div>
            <div style={{ color: C.dim, fontSize: 12, marginBottom: 10 }}>
              {es ? 'Si solo quieres quitarlo de la vista, usa Desactivar. Para borrar de verdad, escribe:' : 'To just hide it, use Deactivate. To truly delete, type:'} <b style={{ color: C.amber }}>{DELETE_PHRASE}</b>
            </div>
            <input value={phrase} onChange={e => setPhrase(e.target.value)} placeholder={DELETE_PHRASE} style={{ ...inputStyle, marginBottom: 12 }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn onClick={deletePermanent} color={C.red} disabled={phrase.trim() !== DELETE_PHRASE}>{es ? 'Borrar permanentemente' : 'Delete permanently'}</Btn>
              <Btn onClick={() => { setConfirmDelete(null); setPhrase(''); }} color={C.dim}>{es ? 'Cancelar' : 'Cancel'}</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pestaña ROLES (placeholder — se activa al confirmar esquema)
// ---------------------------------------------------------------------------
type RoleDef = { id: string; name: string; label: string };
type UserProfile = { id: string; email: string };
type UserRole = { id: string; user_id: string; role_id: string };

function RolesTab({ lang }: { lang: string }) {
  const es = lang === 'es';
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [roles, setRoles] = useState<RoleDef[]>([]);
  const [assignments, setAssignments] = useState<UserRole[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState<string>(''); // user_id en proceso

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3500); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [u, r, ur] = await Promise.all([
        sb.from('user_profiles').select('id,email').order('email'),
        sb.from('roles').select('id,name,label').order('name'),
        sb.from('user_roles').select('id,user_id,role_id'),
      ]);
      setUsers((u.data as UserProfile[]) || []);
      setRoles((r.data as RoleDef[]) || []);
      setAssignments((ur.data as UserRole[]) || []);
    } catch { /* noop */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // rol actual de un usuario (primero encontrado)
  const roleOf = (userId: string) => {
    const a = assignments.find(x => x.user_id === userId);
    if (!a) return null;
    return roles.find(r => r.id === a.role_id) || null;
  };

  // Asignar rol: borra los previos del usuario, inserta el nuevo (un rol por usuario)
  const assign = async (userId: string, roleId: string) => {
    setBusy(userId);
    try {
      await sb.from('user_roles').delete().eq('user_id', userId);
      if (roleId) {
        const { error } = await sb.from('user_roles').insert({ user_id: userId, role_id: roleId });
        if (error) { flash((es ? 'Error: ' : 'Error: ') + error.message); setBusy(''); return; }
      }
      flash(es ? 'Rol actualizado.' : 'Role updated.');
      await load();
    } catch (e: any) { flash((es ? 'Error: ' : 'Error: ') + (e?.message || e)); }
    setBusy('');
  };

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return users;
    return users.filter(u => (u.email || '').toLowerCase().includes(term));
  }, [users, search]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder={es ? 'Buscar por email…' : 'Search by email…'}
          style={{ ...inputStyle, maxWidth: 320 }} />
        <div style={{ flex: 1 }} />
        <Btn onClick={load} color={C.dim}>{loading ? '…' : (es ? '↻ Actualizar' : '↻ Refresh')}</Btn>
      </div>

      {msg && <div style={{ background: C.card, border: '1px solid ' + C.cyan + '55', borderRadius: 9, padding: '8px 12px', color: C.text, fontSize: 12, marginBottom: 10 }}>{msg}</div>}

      <div style={{ color: C.dim, fontSize: 11, marginBottom: 10 }}>
        {es ? 'Un rol por usuario. Cambiar el rol reemplaza el anterior.' : 'One role per user. Changing the role replaces the previous one.'}
      </div>

      {loading ? (
        <div style={{ color: C.dim, padding: 20 }}>{es ? 'Cargando…' : 'Loading…'}</div>
      ) : visible.length === 0 ? (
        <div style={{ color: C.dim, padding: 20 }}>{es ? 'No hay usuarios.' : 'No users.'}</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: C.dim, textAlign: 'left' }}>
                <th style={{ padding: 8, borderBottom: '1px solid ' + C.border }}>Email</th>
                <th style={{ padding: 8, borderBottom: '1px solid ' + C.border }}>{es ? 'Rol actual' : 'Current role'}</th>
                <th style={{ padding: 8, borderBottom: '1px solid ' + C.border }}>{es ? 'Asignar rol' : 'Assign role'}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(u => {
                const current = roleOf(u.id);
                return (
                  <tr key={u.id} style={{ borderBottom: '1px solid ' + C.border + '55' }}>
                    <td style={{ padding: 8, color: C.text }}>{u.email}</td>
                    <td style={{ padding: 8 }}>
                      <span style={{ color: current ? C.green : C.dim, fontWeight: 700, fontSize: 12 }}>
                        {current ? current.label : (es ? 'Sin rol' : 'No role')}
                      </span>
                    </td>
                    <td style={{ padding: 8 }}>
                      <select value={current?.id || ''} disabled={busy === u.id}
                        onChange={e => assign(u.id, e.target.value)}
                        style={{ ...inputStyle, maxWidth: 200, opacity: busy === u.id ? 0.5 : 1 }}>
                        <option value="">{es ? '— Sin rol —' : '— No role —'}</option>
                        {roles.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Componente principal — gateado por Super Admin
// ---------------------------------------------------------------------------
export default function AdminConsole({ lang = 'es', auth }: { lang?: string; auth?: any }) {
  const es = lang === 'es';
  const [tab, setTab] = useState<'techs' | 'roles'>('techs');

  const allowed = isSuperAdminSession(auth);

  if (!allowed) {
    return (
      <div style={{ background: C.card, border: '1px solid ' + C.red + '55', borderRadius: 12, padding: 20, color: C.text }}>
        <div style={{ fontSize: 18, fontWeight: 900, color: C.red, marginBottom: 6 }}>🔒 {es ? 'Acceso restringido' : 'Restricted access'}</div>
        <div style={{ color: C.dim, fontSize: 13 }}>
          {es
            ? 'Esta consola es solo para Super Admin, con sesión iniciada por correo/contraseña. El acceso por PIN no aplica.'
            : 'This console is Super Admin only, with an email/password session. PIN access does not qualify.'}
        </div>
      </div>
    );
  }

  const tabBtn = (id: 'techs' | 'roles', label: string) => (
    <button onClick={() => setTab(id)} style={{
      background: tab === id ? C.cyan + '22' : 'transparent',
      border: '1px solid ' + (tab === id ? C.cyan : C.border),
      borderRadius: 9, padding: '8px 16px', color: tab === id ? C.cyan : C.dim,
      fontWeight: 700, fontSize: 13, cursor: 'pointer',
    }}>{label}</button>
  );

  return (
    <div style={{ color: C.text }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 24, fontWeight: 900 }}>
          🛠️ {es ? 'Consola de administración' : 'Admin Console'}
        </div>
        <span style={{ background: C.green + '22', border: '1px solid ' + C.green, color: C.green, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>SUPER ADMIN</span>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {tabBtn('techs', es ? '👷 Técnicos' : '👷 Technicians')}
        {tabBtn('roles', es ? '🔑 Roles / Usuarios' : '🔑 Roles / Users')}
      </div>

      {tab === 'techs' ? <TechniciansTab lang={lang} /> : <RolesTab lang={lang} />}
    </div>
  );
}