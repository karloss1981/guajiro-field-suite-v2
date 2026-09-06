// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { sb, SUPABASE_CONFIGURED } from '../../../config/supabase';
import { ACCESS_ROLE_LABELS, getAccessPin } from '../../../config/access';
import { getConfiguredAuthMode, signInWithPassword } from '../../../services/auth.service';
import { verifyRoleSecurityPin, verifyTechnicianPin } from '../../../services/security.service';
import { bootstrapFirstSuperAdmin } from '../../../services/userAdmin.service';
import { loginWithRoleEmail } from '../../../services/roleEmailAuth.service';
import { createAuditLog } from '../../../services/audit.service';
import { REGION_LABELS, REGION_PINS, T, TECHS, getTechsByRegion } from '../../../legacy/data';
import { APP_VERSION } from '../../../config/constants';
import './LoginPage.css';

type Role = 'tech' | 'viewer' | 'supervisor' | 'admin' | null;
type Region = 'miami' | 'swfl';

const Icon = ({name}:{name:string}) => {
  const common = {width:24,height:24,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.8,strokeLinecap:'round' as const,strokeLinejoin:'round' as const};
  if(name==='worker') return <svg {...common}><path d="M4 20v-2.5A4.5 4.5 0 0 1 8.5 13h7A4.5 4.5 0 0 1 20 17.5V20"/><circle cx="12" cy="7" r="4"/><path d="M8.4 5.3h7.2M9.2 3.8V2.5h5.6v1.3"/></svg>;
  if(name==='shield') return <svg {...common}><path d="M12 3 4.8 6v5.2c0 4.7 3 8.2 7.2 9.8 4.2-1.6 7.2-5.1 7.2-9.8V6L12 3Z"/><path d="m9.2 12 1.8 1.8 4-4"/></svg>;
  if(name==='map') return <svg {...common}><path d="m3 6.5 5-2 8 2 5-2v13l-5 2-8-2-5 2v-13Z"/><path d="M8 4.5v13M16 6.5v13"/></svg>;
  if(name==='route') return <svg {...common}><circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h3a3 3 0 0 0 3-3V9a3 3 0 0 1 3-3"/></svg>;
  if(name==='camera') return <svg {...common}><path d="M4 8.5h3l1.4-2h7.2l1.4 2h3v10H4z"/><circle cx="12" cy="13.5" r="3.2"/></svg>;
  if(name==='signal') return <svg {...common}><path d="M5 16.5a10 10 0 0 1 14 0M8 13.5a6 6 0 0 1 8 0M11 10.5a2 2 0 0 1 2 0"/><circle cx="12" cy="19" r="1" fill="currentColor" stroke="none"/></svg>;
  if(name==='arrow') return <svg {...common}><path d="M5 12h14M14 7l5 5-5 5"/></svg>;
  if(name==='back') return <svg {...common}><path d="M19 12H5M10 7l-5 5 5 5"/></svg>;
  if(name==='lock') return <svg {...common}><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>;
  if(name==='eye') return <svg {...common}><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="3"/></svg>;
  if(name==='admin') return <svg {...common}><path d="M12 3 5 6v6c0 5 3.3 7.8 7 9 3.7-1.2 7-4 7-9V6l-7-3Z"/><path d="M12 8v8M8 12h8"/></svg>;
  return null;
};

export function LoginScreen({onLogin,lang,setLang}:{onLogin:(a:any)=>void,lang:string,setLang:(l:string)=>void}){
  const t=(T as any)[lang]||T.en;
  const es=lang==='es';
  const [role,setRole]=useState<Role>(null);
  const [region,setRegion]=useState<Region>('miami');
  const [pin,setPin]=useState('');
  const [techId,setTechId]=useState('');
  const [techPin,setTechPin]=useState('');
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [resetMode,setResetMode]=useState(false);
  const [resetId,setResetId]=useState('');
  const [resetPin,setResetPin]=useState('');
  const [resetOk,setResetOk]=useState(false);
  const [accountEmail,setAccountEmail]=useState('');
  const [accountPassword,setAccountPassword]=useState('');
  const [accountLoading,setAccountLoading]=useState(false);
  const [accountError,setAccountError]=useState('');
  const [bootstrapReady,setBootstrapReady]=useState(false);
  const authMode=getConfiguredAuthMode();
  const showSecureLogin=authMode!=='legacy';
  const showLegacyLogin=authMode!=='supabase';
  const allowPublicPinReset=authMode==='legacy';

  const regionInfo=REGION_LABELS[region]||REGION_LABELS.miami;
  const staticTechs=useMemo(()=>getTechsByRegion(region),[region]);
  const [dbTechs,setDbTechs]=useState<any[]>([]);
  useEffect(()=>{
    if(!SUPABASE_CONFIGURED){setDbTechs([]);return;}
    let cancelled=false;
    (async()=>{
      try{
        const {data}=await sb.from('technicians').select('id,name,region,active').eq('region',region).eq('active',true).order('id');
        if(!cancelled&&data)setDbTechs(data);
      }catch{setDbTechs([]);}
    })();
    return()=>{cancelled=true;};
  },[region,SUPABASE_CONFIGURED]);
  const techs=useMemo(()=>{
    if(!dbTechs.length)return staticTechs;
    const seen=new Set(staticTechs.map((t:any)=>String(t.id)));
    const merged=[...staticTechs,...dbTechs.filter((t:any)=>!seen.has(String(t.id)))];
    return merged.sort((a,b)=>String(a.id).localeCompare(String(b.id),undefined,{numeric:true}));
  },[staticTechs,dbTechs]);
  const LOCAL_TECHNICIAN_PIN_KEY = 'guajiro_technician_pins_v1';
  const readLocalTechnicianPins = (): Record<string,string> => {
    try { return JSON.parse(localStorage.getItem(LOCAL_TECHNICIAN_PIN_KEY) || '{}') || {}; }
    catch { return {}; }
  };
  const getLocalTechnicianPin = (techId:string) => String(readLocalTechnicianPins()[techId] || '');

  const clearMessages=()=>setError('');
  const goHome=()=>{setRole(null);setResetMode(false);setError('');setPin('');setTechPin('');setTechId('');setResetId('');setResetPin('');setResetOk(false);};

  const loginAccount=async()=>{
    if(!accountEmail.trim()||!accountPassword){
      setAccountError(es?'Ingresa tu email y contraseña de cuenta segura.':'Enter your secure account email and password.');
      return;
    }
    setAccountLoading(true);setAccountError('');setBootstrapReady(false);
    const result=await loginWithRoleEmail(accountEmail,accountPassword,lang);
    setAccountLoading(false);
    if(result.ok){
      onLogin(result.context);
      return;
    }
    setAccountError(result.message);
    setBootstrapReady(result.code==='unauthorized_email'&&result.canBootstrap);
    createAuditLog({
      action:'login_failed',entity:'auth',
      metadata:{authMode:'supabase',attemptedEmail:accountEmail.trim(),reasonCode:result.code,summary:`Email login failed: ${result.code}`}
    }).catch(()=>{});
  };

  const bootstrapAccount=async()=>{
    setAccountLoading(true);setAccountError('');
    try{
      await bootstrapFirstSuperAdmin();
      const context=await signInWithPassword(accountEmail,accountPassword);
      onLogin(context);
    }catch(bootstrapError:any){
      setAccountError(bootstrapError?.message||'Unable to bootstrap the first Super Admin.');
    }finally{setAccountLoading(false);}
  };

  const loginAccessRole=async()=>{
    if(!role || role==='tech') return;
    clearMessages();setLoading(true);
    const cleanPin=String(pin||'').trim();
    let valid=false;

    // Stabilization fix: in legacy/local mode, never call Supabase RPC before
    // validating the local PIN. The old flow could wait on a dead/placeholder
    // Supabase connection before falling back, causing 10+ second logins.
    if(authMode==='legacy'){
      const expected=getAccessPin(role,region,REGION_PINS[region]);
      valid=Boolean(expected)&&cleanPin===String(expected).trim();
    }else{
      try{valid=await verifyRoleSecurityPin({role,region,pin:cleanPin});}catch{}
      if(!valid&&authMode!=='supabase'){
        const expected=getAccessPin(role,region,REGION_PINS[region]);
        valid=Boolean(expected)&&cleanPin===String(expected).trim();
      }
    }

    setLoading(false);
    if(valid){
      onLogin({role:'supervisor',accessRole:role,authMode:'legacy',region,user:{name:ACCESS_ROLE_LABELS[role].en,region}});
    }else setError(t.wrongPin);
  };

  const loginTech=async()=>{
    if(!techId){setError(t.selectFirst);return;}
    if(!techPin){setError(t.wrongTechPin);return;}
    setLoading(true);setError('');

    const fallback=techs.find(tt=>String(tt.id)===String(techId)) || TECHS.find(tt=>String(tt.id)===String(techId));
    const localPin = getLocalTechnicianPin(techId);

    // Local/legacy mode must not call Supabase before checking the local PIN store.
    // Supervisor PIN Management saves here, so technician login must read here first.
    if(authMode==='legacy' || !SUPABASE_CONFIGURED){
      setLoading(false);
      if(!fallback){setError(t.techNotFound);return;}
      if(!localPin){setError(t.noPinAssigned);return;}
      if(String(techPin).trim()!==String(localPin).trim()){setError(t.wrongTechPin);return;}
      onLogin({role:'tech',accessRole:'tech',authMode:'legacy',tech:{...fallback,active:true,gps_consent:true},region:fallback.region||region,user:{name:fallback.name,id:fallback.id}});
      return;
    }

    const techSelect = authMode === 'supabase' ? 'id,name,region,active,gps_consent' : 'id,name,region,pin,active,gps_consent';
    let data:any=null;
    try{
      const result=await sb.from('technicians').select(techSelect).eq('id',techId).maybeSingle();
      if(result.error)throw result.error;
      data=result.data;
    }catch(connectionError:any){
      // Hybrid mode can still let the technician in on a matching local PIN
      // even if Supabase is unreachable. Pure 'supabase' mode cannot fall
      // back — that mode has no local PIN store to trust.
      if(authMode!=='supabase' && fallback && localPin && String(techPin).trim()===String(localPin).trim()){
        setLoading(false);
        onLogin({role:'tech',accessRole:'tech',authMode:'legacy',tech:{...fallback,active:true,gps_consent:true},region:fallback.region||region,user:{name:fallback.name,id:fallback.id}});
        return;
      }
      setLoading(false);
      setError(es?'Conexión con Supabase fallida. Revisa tu internet e intenta de nuevo.':'Supabase connection failed. Check your internet connection and try again.');
      return;
    }
    if(!data){
      setLoading(false);
      setError(fallback?t.noPinAssigned:t.techNotFound);return;
    }
    let pinValid=false;
    try{ pinValid=await verifyTechnicianPin(techId,techPin); }
    catch{ pinValid=false; }
    if(!pinValid && authMode !== 'supabase' && Boolean(data.pin) && techPin===data.pin){ pinValid=true; }
    if(!pinValid && localPin && techPin===localPin){ pinValid=true; }
    setLoading(false);
    if(!pinValid){setError((data.pin||localPin||authMode==='supabase')?t.wrongTechPin:t.noPinAssigned);return;}
    onLogin({role:'tech',accessRole:'tech',authMode:'legacy',tech:data,region:data.region||region,user:{name:data.name,id:data.id}});
  };

  const saveNewPin=async()=>{
    if(!allowPublicPinReset){setError(es?'Por seguridad, el PIN lo cambia un Admin desde Security.':'For security, an Admin must change the PIN from Security.');return;}
    if(!resetId){setError(t.selectFirst);return;}
    if(!/^\d{4,6}$/.test(resetPin)){setError(t.pinTooShort);return;}
    setLoading(true);setError('');
    if(authMode==='legacy' || !SUPABASE_CONFIGURED){
      const pins=readLocalTechnicianPins();
      pins[String(resetId)]=String(resetPin);
      try{localStorage.setItem(LOCAL_TECHNICIAN_PIN_KEY,JSON.stringify(pins));}catch{}
      setLoading(false);
      setResetOk(true);
      return;
    }
    const {error:saveError}=await sb.from('technicians').update({pin:resetPin}).eq('id',resetId);
    setLoading(false);
    if(saveError){setError(es?'Could not update the PIN. Try again.':'Could not update the PIN. Try again.');return;}
    setResetOk(true);
  };

  const RegionSwitch=()=> (
    <div className="login-region-switch" role="group" aria-label={t.selectRegion}>
      {(['miami','swfl'] as Region[]).map(key=>{
        const info=REGION_LABELS[key];
        return <button key={key} type="button" className={region===key?'active':''} onClick={()=>{setRegion(key);setTechId('');setResetId('');clearMessages();}}>
          <span>{info.emoji}</span><b>{info.name}</b>
        </button>;
      })}
    </div>
  );

  const LanguageSwitch=()=> (
    <div className="login-language">
      <button className={lang==='en'?'active':''} onClick={()=>setLang('en')}>EN</button>
      <button className={lang==='es'?'active':''} onClick={()=>setLang('es')}>ES</button>
    </div>
  );

  const roleDetails = role && role !== 'tech' ? ACCESS_ROLE_LABELS[role] : null;

  const versionBadge=<div style={{position:'fixed',bottom:6,left:0,right:0,textAlign:'center',fontSize:10,color:'#5a7aaa',opacity:.8,pointerEvents:'none',zIndex:5}}>Guajiro Field Suite v{APP_VERSION}</div>;
  return (
    <>
    {versionBadge}

    <main className="login-page">
      <div className="login-noise" />
      <section className="login-hero" aria-label="Guajiro & Sons Field Operations Suite cover image">
        <span className="sr-only">Built for routes, trenches and crews. Login with role-based control.</span>
      </section>

      <section className="login-access">
        <div className="login-access-top"><LanguageSwitch/></div>
        <div className="login-panel">
          {!role && !resetMode && (
            <div className="login-step login-step-enter">
              <div className="login-mobile-brand">
                <div className="login-brand-mark"><Icon name="signal"/></div>
                <strong>GUAJIRO <span>&amp; SONS</span></strong>
              </div>
              <div className="login-heading login-welcome-heading">
                <div className="login-lock-emblem"><Icon name="lock"/></div>
                <span>{es?'ACCESO SEGURO':'SECURE ACCESS'}</span>
                <h2>{es?'Bienvenido de nuevo':'Welcome back'}</h2>
                <p>{es?'Inicia sesión para continuar':'Sign in to continue'}</p>
              </div>


              {showSecureLogin&&(
                <div style={{background:'rgba(7,19,39,.78)',border:'1px solid #2b7fff66',borderRadius:16,padding:16,marginBottom:16}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10,color:'#7db4ff',fontWeight:800}}><Icon name="lock"/> {es?'Secure email login':'Secure email login'}</div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:9}}>
                    <input type="email" autoComplete="email" value={accountEmail} onChange={e=>setAccountEmail(e.target.value)} placeholder={es?'Email':'Email'} style={{background:'#071327',border:'1px solid #294a80',borderRadius:9,padding:'11px 12px',color:'#fff',minWidth:0}}/>
                    <input type="password" autoComplete="current-password" value={accountPassword} onChange={e=>setAccountPassword(e.target.value)} onKeyDown={e=>e.key==='Enter'&&loginAccount()} placeholder={es?'Password':'Password'} style={{background:'#071327',border:'1px solid #294a80',borderRadius:9,padding:'11px 12px',color:'#fff',minWidth:0}}/>
                  </div>
                  {accountError&&<div className="login-error" style={{marginTop:9}}>⚠ {accountError}</div>}
                  {bootstrapReady&&<button type="button" onClick={bootstrapAccount} disabled={accountLoading} style={{width:'100%',marginTop:9,background:'#ffbe0018',border:'1px solid #ffbe0077',borderRadius:9,padding:'10px 12px',color:'#ffcf55',fontWeight:900,cursor:'pointer'}}>{es?'Initialize this account as the first Super Admin':'Initialize this account as the first Super Admin'}</button>}
                  <button className="login-primary supervisor" onClick={loginAccount} disabled={accountLoading} style={{marginTop:10}}><span>{accountLoading?(es?'Signing in...':'Signing in...'):(es?'Sign in securely':'Sign in securely')}</span><Icon name="arrow"/></button>
                  <div style={{fontSize:10,color:'#8ca3c7',marginTop:8}}>{es?'Admin/Supervisor/Viewer usan correo seguro. Técnicos continúan con PIN.':'Admin/Supervisor/Viewer use secure email. Technicians continue with PIN.'}</div>
                </div>
              )}

              {showLegacyLogin&&<div style={{fontSize:10,color:'#8ca3c7',margin:'2px 0 10px',textTransform:'uppercase',letterSpacing:1}}>{es?'PIN access for field roles':'PIN access for field roles'}</div>}
              {showLegacyLogin&&<>
                <div className="login-role-title">{es?'PIN PARA TÉCNICOS, SUPERVISOR Y VIEWER':'PIN ACCESS: TECHNICIAN, SUPERVISOR, VIEWER'}</div>
                <div className="login-role-grid three-up">
                  <button className="login-role-card supervisor" onClick={()=>setRole('supervisor')}>
                    <div className="login-role-icon"><Icon name="shield"/></div>
                    <div><strong>{t.supLabel}</strong><span>{es?'Gestiona equipos, rutas y trabajo':'Manage crews, routes and work'}</span></div>
                    <Icon name="arrow"/>
                  </button>
                  <button className="login-role-card technician" onClick={()=>setRole('tech')}>
                    <div className="login-role-icon"><Icon name="worker"/></div>
                    <div><strong>{t.techLabel}</strong><span>{es?'Trabajos, evidencia y cierre':'Field tasks, evidence and jobs'}</span></div>
                    <Icon name="arrow"/>
                  </button>
                  <button className="login-role-card viewer" onClick={()=>setRole('viewer')}>
                    <div className="login-role-icon"><Icon name="eye"/></div>
                    <div><strong>{es?'Viewer':'Viewer'}</strong><span>{es?'Solo lectura y reportes':'View-only access and reporting'}</span></div>
                    <Icon name="arrow"/>
                  </button>
                </div>
              </>}

              <div className="login-feature-list">
                <div className="login-feature-row orange"><Icon name="arrow"/><span><b>{es?'Cerrar sesión requiere confirmación':'Sign out requires confirmation'}</b><small>{es?'Se te pedirá confirmar antes de salir':'You’ll be asked to confirm before exiting'}</small></span></div>
                <div className="login-feature-row blue"><Icon name="shield"/><span><b>{es?'Navegación protegida':'Protected navigation'}</b><small>{es?'Evita una pantalla en blanco al regresar':'Prevent blank back screen'}</small></span></div>
              </div>

              <div className="login-trust-row">
                <span><Icon name="lock"/>{es?'Encrypted access':'Encrypted access'}</span>
                <span><span className="login-live-dot"/>{es?'Audit-ready workflows':'Audit-ready workflows'}</span>
              </div>
            </div>
          )}

          {role && role!=='tech' && !resetMode && (
            <div className="login-step login-step-enter">
              <button className="login-back" onClick={goHome}><Icon name="back"/>{t.backBtn.replace('← ','')}</button>
              <div className="login-heading compact">
                <div className={`login-heading-icon ${role==='admin'?'admin':role==='viewer'?'viewer':'supervisor'}`}><Icon name={role==='admin'?'admin':role==='viewer'?'eye':'shield'}/></div>
                <span>{roleDetails?.en?.toUpperCase()}</span>
                <h2>{roleDetails?.en} {es?'access':'access'}</h2>
                <p>{roleDetails?.descriptionEn}</p>
              </div>
              <RegionSwitch/>
              <label className="login-label">{es?'Role PIN':'Role PIN'}</label>
              <div className="login-pin-wrap">
                <Icon name="lock"/>
                <input autoFocus type="password" inputMode="numeric" maxLength={6} placeholder="••••••" value={pin}
                  onChange={e=>{setPin(e.target.value.replace(/\D/g,''));clearMessages();}}
                  onKeyDown={e=>e.key==='Enter'&&loginAccessRole()}/>
              </div>
              {error&&<div className="login-error">⚠ {error}</div>}
              <button className={`login-primary ${role==='admin'?'admin':role==='viewer'?'viewer':'supervisor'}`} onClick={loginAccessRole} disabled={loading}>
                <span>{es?'Enter':'Enter'}</span><Icon name="arrow"/>
              </button>
              <div className="login-region-note"><span>{regionInfo.emoji}</span><b>{regionInfo.name}</b> — {regionInfo.sub}</div>
            </div>
          )}

          {role==='tech' && !resetMode && (
            <div className="login-step login-step-enter">
              <button className="login-back" onClick={goHome}><Icon name="back"/>{t.backBtn.replace('← ','')}</button>
              <div className="login-heading compact">
                <div className="login-heading-icon technician"><Icon name="worker"/></div>
                <span>{es?'TECHNICIAN PORTAL':'TECHNICIAN PORTAL'}</span>
                <h2>{es?'Your day starts here':'Your day starts here'}</h2>
                <p>{es?'Choose your region, technician and enter your PIN.':'Choose your region, technician and enter your PIN.'}</p>
              </div>
              <RegionSwitch/>
              <label className="login-label">{t.techNumLabel}</label>
              <div className="login-select-wrap">
                <Icon name="worker"/>
                <select value={techId} onChange={e=>{setTechId(e.target.value);clearMessages();}}>
                  <option value="">{t.selectTech}</option>
                  {techs.map((tech:any)=><option key={tech.id} value={tech.id}>{tech.id} — {tech.name}</option>)}
                </select>
              </div>
              <label className="login-label">{t.techPinLabel}</label>
              <div className="login-pin-wrap">
                <Icon name="lock"/>
                <input type="password" inputMode="numeric" maxLength={6} placeholder="••••" value={techPin}
                  onChange={e=>{setTechPin(e.target.value.replace(/\D/g,''));clearMessages();}}
                  onKeyDown={e=>e.key==='Enter'&&loginTech()}/>
              </div>
              {error&&<div className="login-error">⚠ {error}</div>}
              <button className="login-primary technician" onClick={loginTech} disabled={loading}>
                <span>{loading?t.verifying:t.enter}</span><Icon name="arrow"/>
              </button>
              {allowPublicPinReset&&<button className="login-reset-link" onClick={()=>{setResetMode(true);clearMessages();}}>{t.resetPinLink}</button>}
            </div>
          )}

          {resetMode && (
            <div className="login-step login-step-enter">
              <button className="login-back" onClick={()=>{setResetMode(false);clearMessages();setResetOk(false);}}><Icon name="back"/>{t.backBtn.replace('← ','')}</button>
              <div className="login-heading compact">
                <div className="login-heading-icon reset"><Icon name="lock"/></div>
                <span>{es?'ACCOUNT SECURITY':'ACCOUNT SECURITY'}</span>
                <h2>{t.resetPinTitle}</h2>
                <p>{t.resetPinDesc}</p>
              </div>
              {resetOk ? (
                <div className="login-success">
                  <div>✓</div><strong>{t.pinChangedOk}</strong>
                  <button onClick={()=>{setResetMode(false);setResetOk(false);setResetId('');setResetPin('');}}> {t.enter} <Icon name="arrow"/></button>
                </div>
              ) : (
                <>
                  <RegionSwitch/>
                  <label className="login-label">{t.techNumLabel}</label>
                  <div className="login-select-wrap">
                    <Icon name="worker"/>
                    <select value={resetId} onChange={e=>{setResetId(e.target.value);clearMessages();}}>
                      <option value="">{t.selectTech}</option>
                      {techs.map((tech:any)=><option key={tech.id} value={tech.id}>{tech.id} — {tech.name}</option>)}
                    </select>
                  </div>
                  <label className="login-label">{t.newPinLabel}</label>
                  <div className="login-pin-wrap">
                    <Icon name="lock"/>
                    <input type="password" inputMode="numeric" maxLength={6} placeholder={t.newPinPH} value={resetPin}
                      onChange={e=>{setResetPin(e.target.value.replace(/\D/g,''));clearMessages();}}
                      onKeyDown={e=>e.key==='Enter'&&saveNewPin()}/>
                  </div>
                  {error&&<div className="login-error">⚠ {error}</div>}
                  <button className="login-primary reset" onClick={saveNewPin} disabled={loading}>
                    <span>{loading?t.savingPin:t.savePinBtn}</span><Icon name="arrow"/>
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        <div className="login-access-footer">© 2026 Guajiro &amp; Sons · {es?'Internal use':'Internal use'}</div>
      </section>
    </main>
    </>
  );
}

export default LoginScreen;
