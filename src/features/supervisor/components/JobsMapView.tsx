// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { sb } from '../../../config/supabase';
import { C } from '../../../config/theme';
import { MIAMI_DADE_ZIPS, BROWARD_ZIPS } from '../../../config/regions';
import { FL_ZIP_GEOJSON_URL, GEO_CACHE_KEY, NOMINATIM_URL, isFieldTrackingWindow } from '../../../config/constants';
import { getTechName } from '../../../legacy/data';
import { buildHash, parseHash } from '../../../legacy/routing';
import { downloadPhotosZip } from '../../../services/photos.service';
import { generateJobExcel, generateJobPDF, generateEarningsExcel } from '../../../legacy/reporting';
import { Lightbox } from '../../technician/components/Lightbox';

/* ════════════════════════════════════════════════════
   JOBS MAP VIEW — Leaflet + OpenStreetMap
   Pines por trabajo: 🟡 pendiente, 🟢 hecho, 🔴 no hecho
   ════════════════════════════════════════════════════ */
function loadGeoCache(): {[k:string]:{lat:number,lng:number}} {
  try { return JSON.parse(localStorage.getItem(GEO_CACHE_KEY)||'{}'); } catch { return {}; }
}

function saveGeoCache(cache: {[k:string]:{lat:number,lng:number}}) {
  try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(cache)); } catch {}
}

function JobsMapView({routes, techLocations=[], lang}: {routes:any[], techLocations?:any[], lang:string}) {
  const es = lang === 'es';
  const mapRef = useRef<any>(null);
  const mapInstRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const techMarkersRef = useRef<any[]>([]);
  const zipLayerRef = useRef<any[]>([]);
  const zipLabelRef = useRef<any[]>([]);
  const resolvedRef = useRef<{job:any, coords:{lat:number,lng:number}, idx:number}[]>([]);
  const [geocoding, setGeocoding] = useState(false);
  const [progress, setProgress] = useState({done:0, total:0});
  const [leafletReady, setLeafletReady] = useState(!!(window as any).L);
  const [mapReady, setMapReady] = useState(false);
  const [showDone, setShowDone] = useState(true);
  const [showNotDone, setShowNotDone] = useState(true);
  const [showPending, setShowPending] = useState(true);
  const [showZips, setShowZips] = useState(false);
  const [zipLoadState, setZipLoadState] = useState<'idle'|'loading'|'done'|'error'>('idle');
  const [autoGeocode, setAutoGeocode] = useState(routes.length <= 25);
  const coordsCacheRef = useRef<{[k:string]:{lat:number,lng:number}}>(loadGeoCache());

  useEffect(() => {
    setAutoGeocode(routes.length <= 25);
  }, [routes.length]);

  // Inject pulse keyframes once
  useEffect(() => {
    const id = 'tech-beacon-style';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      @keyframes beacon-ring {
        0%   { transform: scale(1);   opacity: 0.8; }
        100% { transform: scale(2.8); opacity: 0; }
      }
      @keyframes beacon-dot {
        0%, 100% { box-shadow: 0 0 0 0 rgba(0,220,133,0.6); }
        50%       { box-shadow: 0 0 0 8px rgba(0,220,133,0); }
      }
      .tech-beacon-ring {
        position: absolute;
        top: 50%; left: 50%;
        width: 28px; height: 28px;
        margin: -14px 0 0 -14px;
        border-radius: 50%;
        background: rgba(0,220,133,0.35);
        animation: beacon-ring 1.6s ease-out infinite;
        pointer-events: none;
      }
      .tech-beacon-ring.ring2 { animation-delay: 0.55s; }
      .tech-beacon-dot {
        width: 22px; height: 22px;
        border-radius: 50%;
        background: #00dc85;
        border: 3px solid #fff;
        box-shadow: 0 2px 10px rgba(0,220,133,0.7);
        animation: beacon-dot 1.6s ease-in-out infinite;
        display: flex; align-items: center; justify-content: center;
        font-size: 8px; font-weight: 900; color: #04091c;
        font-family: 'Barlow Condensed', sans-serif;
        position: relative; z-index: 2;
      }
      .tech-beacon-wrap {
        position: relative;
        width: 28px; height: 28px;
        display: flex; align-items: center; justify-content: center;
      }
    `;
    document.head.appendChild(style);
  }, []);

  // Load Leaflet CSS + JS from CDN
  useEffect(() => {
    if ((window as any).L) { setLeafletReady(true); return; }
    const css = document.createElement('link');
    css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    css.rel = 'stylesheet';
    document.head.appendChild(css);
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => setLeafletReady(true);
    document.head.appendChild(script);
    return () => {
      try { document.head.removeChild(css); } catch {}
    };
  }, []);

  // Init map once Leaflet is ready
  useEffect(() => {
    if (!leafletReady || !mapRef.current || mapInstRef.current) return;
    const L = (window as any).L;
    const map = L.map(mapRef.current, { zoomControl: true })
      .setView([25.77, -80.19], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);
    mapInstRef.current = map;
    setTimeout(()=>map.invalidateSize(),120);
    setMapReady(true);
  }, [leafletReady]);

  // Load ZIP boundaries from GitHub FL GeoJSON and draw on map
  useEffect(() => {
    if (!mapReady || !mapInstRef.current || !showZips) return;
    const L = (window as any).L;
    const map = mapInstRef.current;
    if (zipLoadState !== 'idle') return;
    setZipLoadState('loading');

    fetch('https://raw.githubusercontent.com/OpenDataDE/State-zip-code-GeoJSON/master/fl_florida_zip_codes_geo.min.json')
      .then(r => r.json())
      .then(gj => {
        if (!gj.features) throw new Error('no features');
        gj.features.forEach((feat: any) => {
          const p = feat.properties || {};
          const zip = String(p.ZCTA5CE10 || p.zip_code || p.ZIP || p.ZCTA5 || p.zip || '').trim();
          const isMiami = MIAMI_DADE_ZIPS.has(zip);
          const isBroward = BROWARD_ZIPS.has(zip);
          if (!isMiami && !isBroward) return;

          const fillColor = isMiami ? '#00b8f5' : '#00dc85';
          const layer = L.geoJSON(feat, {
            style: {
              color: fillColor,
              weight: 1.2,
              opacity: 0.7,
              fillColor,
              fillOpacity: 0.06,
            },
          });
          layer.addTo(map);
          zipLayerRef.current.push(layer);

          // Centroid label
          try {
            const bounds = layer.getBounds();
            const center = bounds.getCenter();
            const label = L.divIcon({
              html: `<div style="font-size:9px;font-weight:700;color:${fillColor};opacity:0.85;white-space:nowrap;text-shadow:0 0 3px #04091c,0 0 6px #04091c;pointer-events:none;">${zip}</div>`,
              iconSize: [38, 14],
              iconAnchor: [19, 7],
              className: '',
            });
            const lbl = L.marker(center, { icon: label, interactive: false, zIndexOffset: -500 });
            lbl.addTo(map);
            zipLabelRef.current.push(lbl);
          } catch {}
        });
        setZipLoadState('done');
      })
      .catch(() => setZipLoadState('error'));
  }, [mapReady, showZips, zipLoadState]);

  // Show/hide ZIP layers
  useEffect(() => {
    if (!mapInstRef.current) return;
    const map = mapInstRef.current;
    zipLayerRef.current.forEach(l => showZips ? map.addLayer(l) : map.removeLayer(l));
    zipLabelRef.current.forEach(l => showZips ? map.addLayer(l) : map.removeLayer(l));
  }, [showZips]);

  const pinColor = (status: string) =>
    status === 'done' ? '#00dc85' : status === 'notdone' ? '#ff3348' : '#ffbe00';

  const makeJobIcon = (L: any, color: string, label: string) => L.divIcon({
    html: `<div style="background:${color};width:26px;height:26px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;"><span style="font-size:9px;font-weight:900;color:#04091c;line-height:1">${label}</span></div>`,
    iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -16], className: '',
  });

  // Re-render markers whenever filter toggles change (no re-geocoding)
  useEffect(() => {
    if (!mapReady || !mapInstRef.current) return;
    const L = (window as any).L;
    const map = mapInstRef.current;
    markersRef.current.forEach(m => map.removeLayer(m));
    markersRef.current = [];
    const bounds: [number,number][] = [];
    resolvedRef.current.forEach(({job, coords, idx}) => {
      const visible =
        (job.status === 'done' && showDone) ||
        (job.status === 'notdone' && showNotDone) ||
        (job.status === 'pending' && showPending);
      if (!visible) return;
      const color = pinColor(job.status);
      const statusLabel = job.status === 'done'
        ? `<span style="color:#00dc85;font-weight:700">✅ ${es?'Completado':'Done'} — ${job.pay_code||''}</span>`
        : job.status === 'notdone'
        ? `<span style="color:#ff3348;font-weight:700">❌ ${job.reason||''}</span>`
        : `<span style="color:#ffbe00;font-weight:700">⏳ ${es?'Pendiente':'Pending'}</span>`;
      const marker = L.marker([coords.lat, coords.lng], { icon: makeJobIcon(L, color, String(idx+1)) });
      marker.bindPopup(`<div style="font-family:Arial,sans-serif;min-width:180px"><div style="font-weight:900;font-size:14px;margin-bottom:4px">#${job.job_id}</div><div style="font-size:12px;margin-bottom:4px">${job.address}${job.city?', '+job.city:''}</div><div style="font-size:11px;color:#555;margin-bottom:6px">👷 ${getTechName(job.tech_id)}</div>${statusLabel}</div>`);
      marker.addTo(map);
      markersRef.current.push(marker);
      bounds.push([coords.lat, coords.lng]);
    });
    if (bounds.length > 0) map.fitBounds(bounds, { padding: [30, 30] });
  }, [mapReady, showDone, showNotDone, showPending, progress.done]);

  // Geocode routes — resolve coords, store in resolvedRef, then trigger re-render
  useEffect(() => {
    if (!mapReady || !routes.length) return;
    let cancelled = false;
    resolvedRef.current = [];

    const geocodeOne = async (job: any): Promise<{lat:number,lng:number}|null> => {
      const key = `${job.address}|${job.city||''}`;
      if (coordsCacheRef.current[key]) return coordsCacheRef.current[key];
      try {
        const q = encodeURIComponent(`${job.address}${job.city?', '+job.city:''}, FL, USA`);
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`,
          { headers: { 'User-Agent': 'GuajiroAndSons-FieldSuite/4.0' } }
        );
        const data = await res.json();
        if (data.length > 0) {
          const coords = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
          coordsCacheRef.current[key] = coords;
          return coords;
        }
      } catch {}
      return null;
    };

    const geocodeAndPin = async () => {
      const uncached: number[] = [];
      routes.forEach((job, i) => {
        const key = `${job.address}|${job.city||''}`;
        const coords = coordsCacheRef.current[key];
        if (coords) resolvedRef.current.push({job, coords, idx: i});
        else uncached.push(i);
      });
      // Trigger render for cached jobs immediately
      if (resolvedRef.current.length > 0) {
        // force re-render by setting a dummy state — use progress
        setProgress(p => ({...p, done: resolvedRef.current.length}));
      }
      if (!uncached.length) { setGeocoding(false); return; }
      if (!autoGeocode) {
        setGeocoding(false);
        setProgress({done: resolvedRef.current.length, total: routes.length});
        return;
      }

      setGeocoding(true);
      setProgress({done: resolvedRef.current.length, total: routes.length});
      for (let b = 0; b < uncached.length && !cancelled; b += 1) {
        const coords = await geocodeOne(routes[uncached[b]]);
        if (cancelled) break;
        if (coords) resolvedRef.current.push({job: routes[uncached[b]], coords, idx: uncached[b]});
        setProgress({done: resolvedRef.current.length, total: routes.length});
        if (b + 1 < uncached.length) await new Promise(r => setTimeout(r, 900));
      }
      if (!cancelled) {
        saveGeoCache(coordsCacheRef.current);
        setGeocoding(false);
      }
    };

    geocodeAndPin();

    return () => { cancelled = true; };
  }, [mapReady, routes, autoGeocode]);

  // Tech beacon markers — update live without re-geocoding jobs
  useEffect(() => {
    if (!mapReady || !mapInstRef.current) return;
    const L = (window as any).L;
    const map = mapInstRef.current;

    // Remove old tech markers
    techMarkersRef.current.forEach(m => map.removeLayer(m));
    techMarkersRef.current = [];

    techLocations.forEach((loc:any) => {
      if (!loc.lat || !loc.lng) return;
      const initials = (loc.tech_name||loc.tech_id||'?').split(' ').map((w:string)=>w[0]).join('').slice(0,2).toUpperCase();
      const mins = loc.updated_at ? Math.round((Date.now()-new Date(loc.updated_at).getTime())/60000) : null;
      const freshness = mins !== null && mins < 5 ? 'green' : mins !== null && mins < 20 ? 'yellow' : 'grey';
      const ringColor = freshness==='green' ? 'rgba(0,220,133,0.35)' : freshness==='yellow' ? 'rgba(255,190,0,0.35)' : 'rgba(120,140,180,0.25)';
      const dotColor  = freshness==='green' ? '#00dc85' : freshness==='yellow' ? '#ffbe00' : '#5a7aaa';
      const dotGlow   = freshness==='green' ? 'rgba(0,220,133,0.7)' : freshness==='yellow' ? 'rgba(255,190,0,0.6)' : 'rgba(90,122,170,0.4)';
      const animStyle = freshness!=='grey' ? 'beacon-ring' : 'none';

      const icon = L.divIcon({
        html: `<div class="tech-beacon-wrap">
          <div class="tech-beacon-ring" style="background:${ringColor};animation-name:${animStyle}"></div>
          <div class="tech-beacon-ring ring2" style="background:${ringColor};animation-name:${animStyle}"></div>
          <div class="tech-beacon-dot" style="background:${dotColor};box-shadow:0 2px 12px ${dotGlow}">${initials}</div>
        </div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        popupAnchor: [0, -18],
        className: '',
      });

      const timeAgo = mins === null ? '' : mins < 1 ? (es?'ahora mismo':'just now') : `${mins}m ${es?'atrás':'ago'}`;
      const marker = L.marker([loc.lat, loc.lng], { icon, zIndexOffset: 1000 });
      marker.bindPopup(`
        <div style="font-family:Arial,sans-serif;min-width:170px">
          <div style="font-weight:900;font-size:13px;margin-bottom:2px">👷 ${loc.tech_name||loc.tech_id}</div>
          <div style="font-size:11px;color:#555">ID: ${loc.tech_id}</div>
          ${timeAgo ? `<div style="font-size:11px;color:${dotColor};margin-top:4px;font-weight:700">📍 ${timeAgo}</div>` : ''}
        </div>
      `);
      marker.addTo(map);
      techMarkersRef.current.push(marker);
    });
  }, [mapReady, techLocations]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mapInstRef.current) {
        mapInstRef.current.remove();
        mapInstRef.current = null;
      }
    };
  }, []);

  const hasMapData = routes.length > 0 || techLocations.some((loc:any) => loc?.lat && loc?.lng);

  const done = routes.filter(r=>r.status==='done').length;
  const nd = routes.filter(r=>r.status==='notdone').length;
  const pend = routes.filter(r=>r.status==='pending').length;
  const trackingOpen = isFieldTrackingWindow();
  const activeTechs = trackingOpen ? techLocations.filter((l:any)=>l.updated_at && (Date.now()-new Date(l.updated_at).getTime())<2*60000).length : 0;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      {/* Stats + legend */}
      <div style={{background:C.card,border:"1px solid #162e58",borderRadius:12,padding:"12px 16px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
        <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:15,fontWeight:800,color:C.text,marginRight:8}}>
          🗺️ {es?'Mapa de Ruta':'Route Map'}
        </div>
        <div style={{fontSize:11,color:trackingOpen?'#00dc85':'#8da4c9',border:`1px solid ${trackingOpen?'#00dc8544':'#8da4c944'}`,borderRadius:20,padding:'3px 9px',background:trackingOpen?'#00dc8514':'#8da4c914'}}>
          {trackingOpen ? (es?'Tracking 7 AM–7 PM activo':'7 AM–7 PM tracking active') : (es?'Tracking apagado fuera de horario':'Tracking off after hours')}
        </div>
        {[
          {color:"#00dc85", label: es?`Completados: ${done}`:`Done: ${done}`, active: showDone, toggle: ()=>setShowDone(v=>!v)},
          {color:"#ff3348", label: es?`No hechos: ${nd}`:`Not done: ${nd}`, active: showNotDone, toggle: ()=>setShowNotDone(v=>!v)},
          {color:"#ffbe00", label: es?`Pendientes: ${pend}`:`Pending: ${pend}`, active: showPending, toggle: ()=>setShowPending(v=>!v)},
        ].map(s=>(
          <button key={s.color} onClick={s.toggle} style={{display:"flex",alignItems:"center",gap:6,background:s.active?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.2)",border:`1px solid ${s.active?s.color:'#162e58'}`,borderRadius:20,padding:"4px 10px",cursor:"pointer",transition:"all .15s",opacity:s.active?1:0.45}}>
            <div style={{width:10,height:10,borderRadius:"50%",background:s.color,flexShrink:0}}/>
            <span style={{fontSize:12,color:s.active?s.color:C.dim,fontWeight:700,whiteSpace:"nowrap"}}>{s.label}</span>
          </button>
        ))}
        {activeTechs > 0 && (
          <div style={{display:"flex",alignItems:"center",gap:6,marginLeft:4,background:"rgba(0,220,133,0.1)",border:"1px solid rgba(0,220,133,0.3)",borderRadius:20,padding:"3px 10px"}}>
            <div style={{width:10,height:10,borderRadius:"50%",background:"#00dc85",boxShadow:"0 0 6px #00dc85"}}/>
            <span style={{fontSize:12,color:"#00dc85",fontWeight:700}}>{activeTechs} {es?"en campo":"in field"}</span>
          </div>
        )}
        <button onClick={()=>setShowZips(v=>!v)} style={{display:"flex",alignItems:"center",gap:6,background:showZips?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.2)",border:`1px solid ${showZips?"#00b8f5":"#162e58"}`,borderRadius:20,padding:"4px 10px",cursor:"pointer",transition:"all .15s",opacity:showZips?1:0.45,marginLeft:"auto"}}>
          <div style={{width:10,height:10,borderRadius:2,background:"transparent",border:"2px solid #00b8f5",flexShrink:0}}/>
          <span style={{fontSize:12,color:showZips?"#00b8f5":C.dim,fontWeight:700,whiteSpace:"nowrap"}}>
            ZIP {zipLoadState==='loading'?'…':zipLoadState==='error'?'✗':''}
          </span>
        </button>
        {geocoding&&(
          <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:120,height:4,background:"#162e58",borderRadius:99,overflow:"hidden"}}>
              <div style={{height:"100%",width:`${progress.total>0?(progress.done/progress.total)*100:0}%`,background:"#00b8f5",borderRadius:99,transition:"width .3s"}}/>
            </div>
            <span style={{fontSize:11,color:"#00b8f5",fontWeight:700}}>{progress.done}/{progress.total}</span>
          </div>
        )}
        {!geocoding && routes.length>25 && progress.done < routes.length && !autoGeocode && (
          <button onClick={()=>setAutoGeocode(true)} style={{background:'#00b8f518',border:'1px solid #00b8f555',borderRadius:20,padding:'4px 10px',color:'#00b8f5',fontSize:12,fontWeight:800,cursor:'pointer'}}>
            {es?'Cargar direcciones faltantes':'Load missing addresses'} ({progress.done}/{routes.length})
          </button>
        )}
      </div>

      {/* ZIP legend */}
      {showZips && zipLoadState==='done' && (
        <div style={{display:"flex",gap:12,padding:"6px 12px",background:C.card,border:"1px solid #162e58",borderRadius:10,flexWrap:"wrap"}}>
          <span style={{fontSize:11,color:C.dim,fontWeight:700,alignSelf:"center"}}>{es?"Zonas ZIP:":"ZIP zones:"}</span>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <div style={{width:16,height:10,background:"rgba(0,184,245,0.15)",border:"1.5px solid #00b8f5",borderRadius:2}}/>
            <span style={{fontSize:11,color:"#00b8f5",fontWeight:700}}>Miami-Dade</span>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <div style={{width:16,height:10,background:"rgba(0,220,133,0.15)",border:"1.5px solid #00dc85",borderRadius:2}}/>
            <span style={{fontSize:11,color:"#00dc85",fontWeight:700}}>Broward</span>
          </div>
        </div>
      )}

      {/* Map container */}
      {!hasMapData?(
        <div style={{height:360,background:C.card,border:"1px solid #162e58",borderRadius:14,display:"flex",alignItems:"center",justifyContent:"center",textAlign:"center",padding:24,color:C.dim,fontSize:13,flexDirection:"column",gap:10}}>
          <div style={{fontSize:42}}>🗺️</div>
          <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:20,fontWeight:900,color:C.text}}>
            {es?'Mapa listo para la próxima ruta':'Map ready for the next route'}
          </div>
          <div style={{maxWidth:520,lineHeight:1.45}}>
            {es?'Importa una ruta o espera una ubicación activa de técnico. No se carga el mapa hasta tener datos, evitando el render roto o pesado.':'Import a route or wait for an active technician location. The map is not loaded until there is data, preventing a broken or heavy map render.'}
          </div>
        </div>
      ):!leafletReady?(
        <div style={{height:500,background:C.card,border:"1px solid #162e58",borderRadius:14,display:"flex",alignItems:"center",justifyContent:"center",color:C.dim,fontSize:13}}>
          ⏳ {es?'Cargando mapa...':'Loading map...'}
        </div>
      ):(
        <div ref={mapRef} style={{height:500,minHeight:500,width:"100%",borderRadius:14,overflow:"hidden",border:"1px solid #162e58",zIndex:1,background:'#061126'}}/>
      )}
    </div>
  );
}

export { JobsMapView };
