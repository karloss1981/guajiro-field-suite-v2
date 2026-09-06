import type { CSSProperties, ReactNode } from 'react';

export const OPS = {
  bg: '#04091c', card: '#0b1830', panel: '#071327', border: '#162e58', text: '#e8f1ff', dim: '#8da4c9', blue: '#00b8f5', green: '#00dc85', red: '#ff3348', yellow: '#ffbe00', purple: '#9d5fff',
};

export function OpsPage({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return <div style={{display:'flex',flexDirection:'column',gap:12}}>
    <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
      <div><div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:24,fontWeight:900,color:OPS.text}}>{title}</div>{subtitle&&<div style={{fontSize:11,color:OPS.dim,marginTop:3}}>{subtitle}</div>}</div>
      {actions&&<div style={{display:'flex',gap:7,flexWrap:'wrap'}}>{actions}</div>}
    </div>
    {children}
  </div>;
}

export function OpsCard({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{background:OPS.card,border:`1px solid ${OPS.border}`,borderRadius:14,padding:14,...style}}>{children}</div>;
}

export function OpsButton({ children, onClick, tone='blue', disabled=false, type='button' }: { children: ReactNode; onClick?:()=>void; tone?:'blue'|'green'|'red'|'yellow'|'purple'|'dim'; disabled?:boolean; type?:'button'|'submit' }) {
  const color={blue:OPS.blue,green:OPS.green,red:OPS.red,yellow:OPS.yellow,purple:OPS.purple,dim:OPS.dim}[tone];
  return <button type={type} disabled={disabled} onClick={onClick} style={{background:`${color}20`,border:`1px solid ${color}88`,borderRadius:8,padding:'8px 11px',color,fontWeight:800,cursor:disabled?'not-allowed':'pointer',opacity: disabled ? .45 : 1,fontSize:11}}>{children}</button>;
}

export const fieldStyle: CSSProperties = {width:'100%',boxSizing:'border-box',background:OPS.panel,border:`1px solid ${OPS.border}`,borderRadius:8,padding:'9px 10px',color:OPS.text,outline:'none',fontSize:12};

export function OpsEmpty({ children }: { children: ReactNode }) {
  return <OpsCard style={{padding:30,textAlign:'center',color:OPS.dim}}>{children}</OpsCard>;
}

export function OpsError({ message }: { message?: string }) {
  if(!message)return null;
  return <div style={{background:'#ff334815',border:'1px solid #ff334855',borderRadius:9,padding:'9px 11px',color:'#ff7788',fontSize:11}}>⚠ {message}</div>;
}
