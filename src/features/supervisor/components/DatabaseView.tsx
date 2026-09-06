// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { sb } from '../../../config/supabase';
import { C } from '../../../config/theme';
import { APP_FIRST_DATE } from '../../../config/constants';

/*
  DATABASE VIEW — paginated history browser
  v18: server-side pagination to avoid infinite reads and reduce Supabase load.
*/
function DatabaseView({lang, region, initialTable, onTableChange}: {lang:string, region:string, initialTable?:string, onTableChange?:(t:string)=>void}) {
  const es = lang === 'es';
  const [activeTable, setActiveTableState] = useState<string>(initialTable||'routes');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState(APP_FIRST_DATE);
  const [dateTo, setDateTo] = useState(new Date().toLocaleDateString('en-CA'));
  const [counts, setCounts] = useState<{[k:string]:number}>({});
  const [sortCol, setSortCol] = useState('');
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('desc');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [totalRows, setTotalRows] = useState(0);
  const [loadError, setLoadError] = useState('');

  const TABLES = [
    {id:'routes', label:es?'📋 Rutas':'📋 Routes', color:'#00b8f5'},
    {id:'completed_jobs', label:es?'✅ Completados':'✅ Completed Jobs', color:'#00dc85'},
    {id:'not_done_reports', label:es?'❌ No Completados':'❌ Not Done', color:'#ff3348'},
    {id:'job_photos', label:es?'📷 Fotos':'📷 Photos', color:'#9d5fff'},
    {id:'tech_notes', label:es?'✉️ Notas Técnicos':'✉️ Tech Notes', color:'#00dc85'},
    {id:'technicians', label:es?'👷 Técnicos':'👷 Technicians', color:'#ffbe00'},
  ];

  const setActiveTable = useCallback((t:string) => {
    setActiveTableState(t);
    setSearch('');
    setPage(0);
    onTableChange?.(t);
  }, [onTableChange]);

  const usesDateRange = activeTable !== 'technicians' && activeTable !== 'job_photos';
  const maxPage = Math.max(0, Math.ceil(totalRows / pageSize) - 1);

  async function tableCount(tableId:string) {
    try {
      let q:any = sb.from(tableId).select('*', { count:'exact', head:true });
      if (tableId !== 'technicians' && tableId !== 'job_photos') {
        if (tableId === 'cancelled_jobs') q = q.gte('source_route_date', dateFrom).lte('source_route_date', dateTo);
        else q = q.gte('date', dateFrom).lte('date', dateTo);
      }
      if (['routes','completed_jobs','technicians'].includes(tableId)) q = q.eq('region', region);
      const { count, error } = await q;
      if (error) return 0;
      return count || 0;
    } catch { return 0; }
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all(TABLES.map(async t => [t.id, await tableCount(t.id)]))
      .then(results => { if(!cancelled) setCounts(Object.fromEntries(results)); })
      .catch(()=>{});
    return () => { cancelled = true; };
  }, [region, dateFrom, dateTo, activeTable]);

  function baseQueryForTable() {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    let q:any = sb.from(activeTable).select('*', { count:'exact' });

    if (activeTable === 'routes') {
      q = q.eq('region', region).gte('date', dateFrom).lte('date', dateTo).order('date', {ascending:false}).order('tech_id').order('order_num');
    } else if (activeTable === 'completed_jobs') {
      q = q.eq('region', region).gte('date', dateFrom).lte('date', dateTo).order('date', {ascending:false}).order('completed_at', {ascending:false});
    } else if (activeTable === 'not_done_reports') {
      // Do not select individual columns here; older projects may have slightly different schemas.
      // Region is filtered client-side to avoid 400 errors on projects that have not run the region migration.
      q = q.gte('date', dateFrom).lte('date', dateTo).order('created_at', {ascending:false});
    } else if (activeTable === 'job_photos') {
      q = q.order('created_at', {ascending:false});
    } else if (activeTable === 'tech_notes') {
      q = q.gte('date', dateFrom).lte('date', dateTo).order('created_at', {ascending:false});
    } else if (activeTable === 'technicians') {
      q = q.eq('region', region).order('id');
    }
    return q.range(from, to);
  }

  const loadTable = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const { data: rows, count, error } = await baseQueryForTable();
      if (error) throw error;
      const filteredByRegion = (rows || []).filter((row:any) => {
        if (['not_done_reports','tech_notes','job_photos'].includes(activeTable)) {
          return !row.region || row.region === region;
        }
        return true;
      });
      setData(filteredByRegion);
      setTotalRows(count || filteredByRegion.length || 0);
    } catch (e:any) {
      console.error('DatabaseView load failed:', e);
      setData([]);
      setTotalRows(0);
      setLoadError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [activeTable, dateFrom, dateTo, page, pageSize, region]);

  useEffect(() => { loadTable(); }, [loadTable]);
  useEffect(() => { if (page > maxPage) setPage(maxPage); }, [maxPage, page]);

  const filtered = useMemo(() => data.filter(row => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return Object.values(row).some(v => String(v||'').toLowerCase().includes(s));
  }), [data, search]);

  const sorted = useMemo(() => [...filtered].sort((a,b) => {
    if (!sortCol) return 0;
    const av = String(a[sortCol]||''), bv = String(b[sortCol]||'');
    return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
  }), [filtered, sortCol, sortDir]);

  const cols = data.length > 0 ? Object.keys(data[0]).filter(k => k !== 'id' && k !== 'photo_url' && k !== 'thumb_url') : [];

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(sorted);
    XLSX.utils.book_append_sheet(wb, ws, activeTable);
    XLSX.writeFile(wb, `${activeTable}_${dateFrom}_${dateTo}_page_${page+1}.xlsx`);
  };

  const statusColor = (v:any) => {
    const s = String(v || '').toLowerCase();
    if (['done','completed'].includes(s)) return '#00dc85';
    if (['notdone','not_done','not_completed','cancelled'].includes(s)) return '#ff3348';
    if (['pending','assigned'].includes(s)) return '#ffbe00';
    return C.text;
  };

  const pageStart = totalRows ? page * pageSize + 1 : 0;
  const pageEnd = Math.min(totalRows, (page + 1) * pageSize);

  const PaginationControls = () => (
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,flexWrap:'wrap',padding:'10px 0'}}>
      <div style={{fontSize:11,color:C.dim}}>
        {loading ? (es?'Cargando...':'Loading...') : `${pageStart}-${pageEnd} ${es?'de':'of'} ${totalRows.toLocaleString()} ${es?'registros':'records'}`}
        {search ? ` · ${sorted.length} ${es?'en esta página':'on this page'}` : ''}
      </div>
      <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
        <select value={pageSize} onChange={e=>{setPageSize(Number(e.target.value));setPage(0);}} style={{background:'#0e1e3a',border:'1px solid #162e58',borderRadius:8,padding:'7px 8px',color:C.text,fontSize:11}}>
          {[25,50,100].map(n=><option key={n} value={n}>{n} / page</option>)}
        </select>
        <button onClick={()=>setPage(0)} disabled={page===0||loading} style={pagerBtn(page===0||loading)}>«</button>
        <button onClick={()=>setPage(p=>Math.max(0,p-1))} disabled={page===0||loading} style={pagerBtn(page===0||loading)}>{es?'Anterior':'Prev'}</button>
        <span style={{fontSize:11,color:C.text,padding:'0 4px'}}>{es?'Página':'Page'} {page+1} / {maxPage+1}</span>
        <button onClick={()=>setPage(p=>Math.min(maxPage,p+1))} disabled={page>=maxPage||loading} style={pagerBtn(page>=maxPage||loading)}>{es?'Siguiente':'Next'}</button>
        <button onClick={()=>setPage(maxPage)} disabled={page>=maxPage||loading} style={pagerBtn(page>=maxPage||loading)}>»</button>
      </div>
    </div>
  );

  function pagerBtn(disabled:boolean){
    return {background:disabled?'#0b1327':'#00b8f518',border:'1px solid #00b8f544',borderRadius:8,padding:'7px 10px',color:disabled?'#52637f':'#00b8f5',fontSize:11,fontWeight:800,cursor:disabled?'not-allowed':'pointer'} as React.CSSProperties;
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      <div style={{background:C.card,border:'1px solid #162e58',borderRadius:14,padding:16}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap',marginBottom:12}}>
          <div>
            <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:20,fontWeight:900,color:C.text}}>🗄️ {es?'Historial paginado':'Paginated history'}</div>
            <div style={{fontSize:11,color:C.dim,marginTop:3}}>{es?'Carga por páginas para aliviar Supabase y evitar lectura infinita.':'Loads one page at a time to reduce Supabase reads and stop infinite scrolling.'}</div>
          </div>
          <button onClick={loadTable} disabled={loading} style={{background:'#00b8f518',border:'1px solid #00b8f555',borderRadius:9,padding:'8px 12px',color:'#00b8f5',fontWeight:800,cursor:'pointer'}}>↻ {es?'Recargar':'Refresh'}</button>
        </div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:12}}>
          {TABLES.map(t=>(
            <button key={t.id} onClick={()=>setActiveTable(t.id)} style={{background:activeTable===t.id?t.color:`${t.color}18`,border:`1px solid ${t.color}44`,borderRadius:8,padding:'6px 12px',color:activeTable===t.id?'#04091c':t.color,fontFamily:"'Barlow Condensed',sans-serif",fontSize:12,fontWeight:800,cursor:'pointer',display:'flex',alignItems:'center',gap:5}}>
              {t.label}<span style={{background:activeTable===t.id?'rgba(0,0,0,0.2)':t.color+'33',borderRadius:20,padding:'1px 6px',fontSize:10}}>{counts[t.id]||0}</span>
            </button>
          ))}
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:8,marginBottom:10}}>
          {usesDateRange && <>
            <div><label style={{fontSize:10,color:C.dim,display:'block',marginBottom:3}}>{es?'Desde':'From'}</label><input type='date' value={dateFrom} onChange={e=>{setDateFrom(e.target.value);setPage(0);}} style={inputStyle}/></div>
            <div><label style={{fontSize:10,color:C.dim,display:'block',marginBottom:3}}>{es?'Hasta':'To'}</label><input type='date' value={dateTo} onChange={e=>{setDateTo(e.target.value);setPage(0);}} style={inputStyle}/></div>
          </>}
          <div style={{gridColumn:'span 2'}}><label style={{fontSize:10,color:C.dim,display:'block',marginBottom:3}}>{es?'Buscar en esta página':'Search this page'}</label><input value={search} onChange={e=>setSearch(e.target.value)} placeholder={es?'Filtra solo los registros cargados en esta página...':'Filters only the records loaded on this page...'} style={inputStyle}/></div>
        </div>
        <PaginationControls />
        {loadError && <div style={{marginTop:8,background:'#2a0712',border:'1px solid #ff334866',borderRadius:10,padding:10,color:'#ff9aaa',fontSize:12}}>⚠️ {loadError}</div>}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,flexWrap:'wrap',marginTop:6}}>
          <span style={{fontSize:11,color:C.dim}}>{es?'El botón Exportar descarga solo la página visible.':'Export downloads only the visible page.'}</span>
          <button onClick={exportExcel} disabled={sorted.length===0} style={{background:'#00dc8518',border:'1px solid #00dc8544',borderRadius:8,padding:'7px 14px',color:'#00dc85',fontSize:12,fontWeight:800,cursor:'pointer',opacity:sorted.length===0?0.4:1}}>📥 {es?'Exportar página':'Export page'}</button>
        </div>
      </div>

      {loading ? <EmptyBox text={es?'Cargando datos...':'Loading data...'} /> : sorted.length === 0 ? <EmptyBox text={es?'Sin registros para este período o página.':'No records for this period or page.'} /> : <div style={{background:C.card,border:'1px solid #162e58',borderRadius:14,overflow:'hidden'}}>
        {activeTable === 'job_photos' ? (
          <div style={{padding:12,display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(120px,1fr))',gap:8}}>
            {sorted.map((row,i)=><div key={row.id||i} style={{borderRadius:8,overflow:'hidden',border:'1px solid #162e58',background:'#0a1428'}}><img src={row.thumb_url||row.photo_url} alt='' loading='lazy' style={{width:'100%',height:100,objectFit:'cover',display:'block'}} onError={(e:any)=>{e.target.style.display='none';}}/><div style={{padding:'4px 6px'}}><div style={{fontSize:9,color:row.photo_type==='after'?'#00dc85':'#ffbe00',fontWeight:800}}>{row.photo_type?.toUpperCase()||'PHOTO'}</div><div style={{fontSize:9,color:C.dim}}>#{row.job_id}</div></div></div>)}
          </div>
        ) : (
          <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:11,fontFamily:"'Barlow',sans-serif"}}><thead><tr style={{background:'#0e1e3a',borderBottom:'2px solid #162e58'}}>{cols.map(col=><th key={col} onClick={()=>{if(sortCol===col){setSortDir(d=>d==='asc'?'desc':'asc');}else{setSortCol(col);setSortDir('asc');}}} style={{padding:'10px 12px',textAlign:'left',color:sortCol===col?C.accent:C.dim,fontWeight:800,textTransform:'uppercase',letterSpacing:1,cursor:'pointer',whiteSpace:'nowrap',fontSize:10}}>{col.replace(/_/g,' ')} {sortCol===col?(sortDir==='asc'?'↑':'↓'):''}</th>)}</tr></thead><tbody>{sorted.map((row,i)=><tr key={row.id||i} style={{borderBottom:'1px solid #162e5830'}}>{cols.map(col=>{const val=row[col];const isStatus=col==='status';const isDate=col==='date'||col==='created_at'||col==='updated_at'||col==='completed_at';const display=isDate&&val?new Date(val).toLocaleString():String(val??'—');return <td key={col} style={{padding:'8px 12px',color:isStatus?statusColor(val):C.text,fontWeight:isStatus?800:400,whiteSpace:'nowrap',maxWidth:260,overflow:'hidden',textOverflow:'ellipsis'}}>{display}</td>;})}</tr>)}</tbody></table></div>
        )}
        <div style={{padding:'0 14px'}}><PaginationControls /></div>
      </div>}
    </div>
  );
}

const inputStyle: React.CSSProperties = {width:'100%',boxSizing:'border-box',background:'#0e1e3a',border:'1px solid #162e58',borderRadius:8,padding:'8px',color:C.text,fontSize:12,fontFamily:"'Barlow',sans-serif",outline:'none'};
function EmptyBox({text}:{text:string}){return <div style={{background:C.card,border:'1px solid #162e58',borderRadius:14,padding:40,textAlign:'center',color:C.dim}}>{text}</div>;}

export { DatabaseView };
