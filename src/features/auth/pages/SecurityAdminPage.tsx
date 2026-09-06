// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppRole } from '../../../types/roles';
import { ROLE_LABELS } from '../../../types/roles';
import { createAuditLog } from '../../../services/audit.service';
import { getSecurityRuntimeStatus, setRoleSecurityPin } from '../../../services/security.service';
import {
  bootstrapFirstSuperAdmin,
  createSecureUserAccount,
  getAdminEmailRequired,
  getLegacyAccessEnabled,
  getTechnicianPinAccessEnabled,
  listManagedUsers,
  replaceUserRole,
  setLegacyAccessEnabled,
  updateManagedUserProfile,
} from '../../../services/userAdmin.service';
import { getTechsByRegion, TECHS } from '../../../legacy/data';
import { isOfficialSuperAdminEmail } from '../../../services/superAdminAuth.service';
import { OpsButton, OpsCard, OpsEmpty, OpsError, OpsPage, OPS, fieldStyle } from '../../operations/components/OperationsPrimitives';

const ROLES: AppRole[] = ['super_admin','admin','supervisor','dispatcher','viewer','technician'];

export default function SecurityAdminPage({region,lang,actorName='Admin'}:{region:'miami'|'swfl';lang:string;actorName?:string}){
  const es=lang==='es';
  const [users,setUsers]=useState<any[]>([]);
  const [legacyEnabled,setLegacyEnabledState]=useState<boolean|null>(null);
  const [adminEmailRequired,setAdminEmailRequiredState]=useState<boolean|null>(null);
  const [techPinEnabled,setTechPinEnabledState]=useState<boolean|null>(null);
  const [runtimeStatus,setRuntimeStatus]=useState<any>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [pinRole,setPinRole]=useState<'admin'|'supervisor'|'viewer'>('admin');
  const [pinRegion,setPinRegion]=useState<'miami'|'swfl'>(region);
  const [pinValue,setPinValue]=useState('');
  const [createForm,setCreateForm]=useState({email:'',password:'',display_name:'',role:'technician' as AppRole,region,technician_id:''});
  const techs=useMemo(()=>getTechsByRegion(createForm.region),[createForm.region]);
  const technicianCoverage=useMemo(()=>{
    const covered=new Set(users.filter((u:any)=>(u.roles||[]).includes('technician')&&u.technician_id).map((u:any)=>String(u.technician_id)));
    return {covered:covered.size,total:TECHS.length};
  },[users]);

  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try{
      const [managed,legacy,adminEmail,techPin,runtime]=await Promise.all([listManagedUsers(),getLegacyAccessEnabled(),getAdminEmailRequired(),getTechnicianPinAccessEnabled(),getSecurityRuntimeStatus()]);
      setUsers(managed);setLegacyEnabledState(legacy);setAdminEmailRequiredState(adminEmail);setTechPinEnabledState(techPin);setRuntimeStatus(runtime);
    }catch(e:any){setError(e.message||String(e));}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{load();},[load]);

  const run=async(key:string,fn:()=>Promise<any>,success:string)=>{
    setBusy(key);setError('');setNotice('');
    try{await fn();setNotice(success);await load();}
    catch(e:any){setError(e.message||String(e));}
    finally{setBusy('');}
  };

  const createAccount=()=>run('create',async()=>{
    if(!createForm.email||!createForm.password||!createForm.display_name)throw new Error(es?'Email, contraseña y nombre son obligatorios.':'Email, password, and name are required.');
    if(createForm.password.length<8)throw new Error(es?'La contraseña debe tener al menos 8 caracteres.':'Password must contain at least 8 characters.');
    if(createForm.role==='technician'&&!createForm.technician_id)throw new Error(es?'Selecciona el número del técnico.':'Select the technician number.');
    const created=await createSecureUserAccount({email:createForm.email,password:createForm.password,displayName:createForm.display_name,role:createForm.role,region:createForm.region,technicianId:createForm.role==='technician'?createForm.technician_id:null});
    await createAuditLog({action:'secure_user_created',entity:'user_profile',entityId:created.user_id,metadata:{actorName,email:createForm.email,role:createForm.role,region:createForm.region,technician_id:createForm.technician_id||null}});
    setCreateForm({email:'',password:'',display_name:'',role:'technician',region,technician_id:''});
  },es?'Cuenta segura creada.':'Secure account created.');

  const savePin=()=>run('pin',async()=>{
    if(!/^\d{4,8}$/.test(pinValue))throw new Error(es?'El PIN debe contener de 4 a 8 dígitos.':'PIN must contain 4 to 8 digits.');
    await setRoleSecurityPin({role:pinRole,region:pinRegion,pin:pinValue});
    await createAuditLog({action:'role_security_pin_updated',entity:'role_security_pin',entityId:`${pinRole}:${pinRegion}`,metadata:{actorName,role:pinRole,region:pinRegion}});
    setPinValue('');
  },es?'PIN protegido actualizado.':'Protected PIN updated.');

  const toggleLegacy=()=>run('legacy',async()=>{
    if(legacyEnabled===true){
      const gap=technicianCoverage.total-technicianCoverage.covered;
      const warningMsg=es
        ?`Desactivar acceso legacy bloqueará los PINs locales. ${technicianCoverage.covered}/${technicianCoverage.total} técnicos tienen cuenta segura vinculada${gap>0?` — ${gap} se quedarían sin poder entrar`:''}. Confirma que ya existen cuentas y roles seguros.`
        :`Disabling legacy access will block local PIN access. ${technicianCoverage.covered}/${technicianCoverage.total} technicians have a linked secure account${gap>0?` — ${gap} would be locked out`:''}. Confirm that secure accounts and roles are ready.`;
      if(!window.confirm(warningMsg))return;
    }
    const next=!legacyEnabled;
    await setLegacyAccessEnabled(next);
    await createAuditLog({action:'legacy_access_changed',entity:'app_settings',entityId:'legacy_access_enabled',metadata:{actorName,previous:legacyEnabled,next,technicianCoverage}});
  },legacyEnabled?(es?'Acceso legacy desactivado.':'Legacy access disabled.'):(es?'Acceso legacy activado.':'Legacy access enabled.'));

  return <OpsPage title={es?'🔐 Seguridad y usuarios':'🔐 Security & Users'} subtitle={es?'Cuentas Supabase, perfiles, roles, PINs hasheados y transición fuera del acceso legacy.':'Supabase accounts, profiles, roles, hashed PINs, and the transition away from legacy access.'} actions={<OpsButton onClick={load} tone="dim">↻ {es?'Actualizar':'Refresh'}</OpsButton>}>
    <OpsError message={error}/>{notice&&<div style={{background:'#00dc8515',border:'1px solid #00dc8566',borderRadius:9,padding:10,color:OPS.green,fontSize:11}}>✓ {notice}</div>}
    <div style={{background:'#00b8f514',border:'1px solid #00b8f555',borderRadius:10,padding:'11px 13px',fontSize:11,color:OPS.text,lineHeight:1.7}}>
      🔑 {es
        ? <><b>Super Admin</b>: control total, incluye borrar rutas. <b>Admin/Supervisor</b>: editar, no borrar. <b>Viewer</b>: solo lectura. <b>Técnicos</b>: PIN. Admin, Supervisor y Viewer entran con correo/contraseña seguro (Supabase); los técnicos siguen entrando por PIN.</>
        : <><b>Super Admin</b>: full control, including route deletion. <b>Admin/Supervisor</b>: edit, no delete. <b>Viewer</b>: read-only. <b>Technicians</b>: PIN. Admin, Supervisor and Viewer sign in with secure email/password (Supabase); technicians continue signing in with PIN.</>}
    </div>
    <OpsCard><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap'}}><div><b style={{color:OPS.text}}>{es?'Modo de compatibilidad legacy':'Legacy compatibility mode'}</b><div style={{fontSize:10,color:OPS.dim,marginTop:3}}>{legacyEnabled===null?'…':legacyEnabled?(es?'ACTIVO: los accesos locales siguen permitidos temporalmente.':'ACTIVE: local access remains temporarily permitted.'):(es?'DESACTIVADO: solo cuentas Supabase autenticadas.':'DISABLED: authenticated Supabase accounts only.')}</div><div style={{fontSize:10,color:OPS.dim,marginTop:2}}>{es?`Cobertura técnicos con cuenta segura: ${technicianCoverage.covered}/${technicianCoverage.total}`:`Technicians with a linked secure account: ${technicianCoverage.covered}/${technicianCoverage.total}`}</div></div><OpsButton disabled={legacyEnabled===null||busy==='legacy'} onClick={toggleLegacy} tone={legacyEnabled?'red':'green'}>{legacyEnabled?(es?'Desactivar legacy':'Disable legacy'):(es?'Activar temporalmente':'Temporarily enable')}</OpsButton></div></OpsCard>

    <OpsCard>
      <b style={{color:OPS.text}}>🧭 {es?'Estado de seguridad v25':'v25 Security status'}</b>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:8,marginTop:10}}>
        <SecurityChip label={es?'Sesión Supabase':'Supabase session'} value={runtimeStatus?.hasSession? (es?'Activa':'Active') : (es?'No detectada':'Not detected')} ok={Boolean(runtimeStatus?.hasSession)}/>
        <SecurityChip label={es?'Cuenta actual':'Current account'} value={runtimeStatus?.email?(isOfficialSuperAdminEmail(runtimeStatus.email)?(es?'Super Admin oficial':'Official Super Admin'):runtimeStatus.email):(es?'Sin sesión':'No session')} ok={isOfficialSuperAdminEmail(runtimeStatus?.email)}/>
        <SecurityChip label={es?'Admin por email':'Admin email'} value={adminEmailRequired===false?'Optional':'Required'} ok={adminEmailRequired!==false}/>
        <SecurityChip label={es?'Técnico por PIN':'Technician PIN'} value={techPinEnabled===false?'Disabled':'Enabled'} ok={techPinEnabled!==false}/>
        <SecurityChip label={es?'Legacy PIN':'Legacy PIN'} value={legacyEnabled?'Transition':'Locked'} ok={!legacyEnabled}/>
      </div>
      {runtimeStatus?.errors?.length>0&&<div style={{marginTop:9,fontSize:10,color:OPS.yellow}}>⚠ {runtimeStatus.errors.join(' · ')}</div>}
      <div style={{marginTop:10,fontSize:10,color:OPS.dim,lineHeight:1.5}}>
        {es?'Mejor práctica: mantener Admin/Supervisor/Viewer con cuenta Supabase; técnicos con PIN hasheado hasta migración completa. No desactives legacy si todavía dependes de PIN técnico anónimo. Borrar rutas nunca acepta PIN, solo sesión Super Admin.':'Best practice: keep Admin/Supervisor/Viewer on Supabase accounts; technicians remain on hashed PIN until the full migration. Do not disable legacy if technician PIN access still depends on anonymous sessions. Route deletion never accepts a PIN, only an active Super Admin session.'}
      </div>
    </OpsCard>

    <OpsCard><b style={{color:OPS.text}}>{es?'Crear cuenta segura':'Create secure account'}</b><div style={{fontSize:10,color:OPS.dim,margin:'3px 0 10px'}}>{es?'Requiere desplegar la Edge Function admin-create-user. La clave service role nunca se expone en el navegador.':'Requires the admin-create-user Edge Function to be deployed. The service-role key is never exposed in the browser.'}</div><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:7}}><input style={fieldStyle} placeholder="Email" type="email" value={createForm.email} onChange={e=>setCreateForm(f=>({...f,email:e.target.value}))}/><input style={fieldStyle} placeholder={es?'Nombre visible':'Display name'} value={createForm.display_name} onChange={e=>setCreateForm(f=>({...f,display_name:e.target.value}))}/><input style={fieldStyle} placeholder={es?'Contraseña temporal':'Temporary password'} type="password" value={createForm.password} onChange={e=>setCreateForm(f=>({...f,password:e.target.value}))}/><select style={fieldStyle} value={createForm.role} onChange={e=>setCreateForm(f=>({...f,role:e.target.value,technician_id:e.target.value==='technician'?f.technician_id:''}))}>{ROLES.map(r=><option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select><select style={fieldStyle} value={createForm.region} onChange={e=>setCreateForm(f=>({...f,region:e.target.value,technician_id:''}))}><option value="miami">Miami</option><option value="swfl">SW Florida</option></select>{createForm.role==='technician'&&<select style={fieldStyle} value={createForm.technician_id} onChange={e=>setCreateForm(f=>({...f,technician_id:e.target.value}))}><option value="">{es?'Seleccionar técnico':'Select technician'}</option>{techs.map((t:any)=><option key={t.id} value={t.id}>#{t.id} · {t.name}</option>)}</select>}</div><div style={{marginTop:8}}><OpsButton disabled={busy==='create'} onClick={createAccount} tone="green">{busy==='create'?'…':es?'Crear cuenta':'Create account'}</OpsButton></div></OpsCard>

    <OpsCard><b style={{color:OPS.text}}>{es?'PINs de seguridad hasheados':'Hashed security PINs'}</b><div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr auto',gap:7,marginTop:9}}><select style={fieldStyle} value={pinRole} onChange={e=>setPinRole(e.target.value)}><option value="admin">Admin</option><option value="supervisor">Supervisor</option><option value="viewer">Viewer</option></select><select style={fieldStyle} value={pinRegion} onChange={e=>setPinRegion(e.target.value)}><option value="miami">Miami</option><option value="swfl">SW Florida</option></select><input style={fieldStyle} type="password" inputMode="numeric" maxLength={8} placeholder="PIN 4–8" value={pinValue} onChange={e=>setPinValue(e.target.value.replace(/\D/g,''))}/><OpsButton disabled={busy==='pin'} onClick={savePin} tone="purple">{es?'Guardar PIN':'Save PIN'}</OpsButton></div></OpsCard>

    <OpsCard><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}><div><b style={{color:OPS.text}}>{es?'Usuarios administrados':'Managed users'}</b><div style={{fontSize:10,color:OPS.dim}}>{es?'La lista contiene perfiles públicos, no contraseñas ni secretos de Auth.':'This list contains public profiles, never passwords or Auth secrets.'}</div></div><OpsButton disabled={busy==='bootstrap'} onClick={()=>run('bootstrap',async()=>{await bootstrapFirstSuperAdmin();},es?'Primer Super Admin asignado.':'First Super Admin assigned.')} tone="yellow">{es?'Inicializar primer Super Admin':'Bootstrap first Super Admin'}</OpsButton></div></OpsCard>
    {loading?<OpsEmpty>{es?'Cargando usuarios…':'Loading users…'}</OpsEmpty>:users.length===0?<OpsEmpty>{es?'No existen perfiles todavía. Inicia sesión con la primera cuenta y usa Bootstrap.':'No profiles exist yet. Sign in with the first account and use Bootstrap.'}</OpsEmpty>:users.map(user=><ManagedUserCard key={user.user_id} user={user} lang={lang} busy={busy} setBusy={setBusy} setError={setError} setNotice={setNotice} reload={load} actorName={actorName}/>) }
  </OpsPage>;
}

function SecurityChip({label,value,ok}:{label:string;value:string;ok:boolean}){
  return <div style={{background:ok?'#00dc8514':'#ffbe0014',border:`1px solid ${ok?'#00dc8566':'#ffbe0066'}`,borderRadius:10,padding:'10px 12px'}}><div style={{fontSize:9,color:OPS.dim,textTransform:'uppercase',letterSpacing:.8}}>{label}</div><div style={{fontSize:18,fontWeight:900,color:ok?OPS.green:OPS.yellow}}>{value}</div></div>;
}

function ManagedUserCard({user,lang,busy,setBusy,setError,setNotice,reload,actorName}:any){
  const es=lang==='es';
  const [displayName,setDisplayName]=useState(user.display_name||'');
  const [region,setRegion]=useState(user.region||'miami');
  const [technicianId,setTechnicianId]=useState(user.technician_id||'');
  const [active,setActive]=useState(user.active!==false);
  const [role,setRole]=useState(user.roles?.[0]||'viewer');
  const techs=useMemo(()=>getTechsByRegion(region),[region]);
  const save=async()=>{setBusy(user.user_id);setError('');try{await updateManagedUserProfile({userId:user.user_id,displayName,region,technicianId:role==='technician'?technicianId:null,active});await replaceUserRole(user.user_id,role);await createAuditLog({action:'user_access_updated',entity:'user_profile',entityId:user.user_id,metadata:{actorName,displayName,region,technician_id:role==='technician'?technicianId:null,active,role}});setNotice(es?'Usuario actualizado.':'User updated.');await reload();}catch(e:any){setError(e.message||String(e));}finally{setBusy('');}};
  return <OpsCard><div style={{display:'grid',gridTemplateColumns:'minmax(220px,1.5fr) repeat(4,minmax(130px,1fr)) auto',gap:7,alignItems:'center'}}><div><b style={{color:OPS.blue}}>{user.display_name||user.user_id}</b><div style={{fontSize:9,color:OPS.dim,wordBreak:'break-all'}}>{user.user_id}</div><div style={{fontSize:9,color:OPS.purple}}>{(user.roles||[]).join(', ')||'No role'}</div></div><input style={fieldStyle} value={displayName} onChange={e=>setDisplayName(e.target.value)} placeholder="Display name"/><select style={fieldStyle} value={role} onChange={e=>setRole(e.target.value)}>{ROLES.map(r=><option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select><select style={fieldStyle} value={region} onChange={e=>{setRegion(e.target.value);setTechnicianId('')}}><option value="miami">Miami</option><option value="swfl">SW Florida</option></select>{role==='technician'?<select style={fieldStyle} value={technicianId} onChange={e=>setTechnicianId(e.target.value)}><option value="">Tech #</option>{techs.map((t:any)=><option key={t.id} value={t.id}>#{t.id} {t.name}</option>)}</select>:<label style={{fontSize:11,color:OPS.dim}}><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}/> {es?'Activo':'Active'}</label>}<OpsButton disabled={busy===user.user_id} onClick={save} tone="green">{busy===user.user_id?'…':es?'Guardar':'Save'}</OpsButton></div></OpsCard>;
}
