const fs = require('fs');
const f = 'src/features/supervisor/pages/SupervisorPortal.tsx';
let s = fs.readFileSync(f, 'utf8');
const old = "    const normalized=regionTechs.map((tech:any)=>{\n      const dbTech=dbById.get(String(tech.id))||{};\n      return {...dbTech,id:tech.id,name:tech.name,region:tech.region,active:dbTech.active??true,pin:dbTech.pin??null};\n    });";
const neu = "    const rosterIds=new Set(regionTechs.map((t:any)=>String(t.id)));\n    const normalized=regionTechs.map((tech:any)=>{\n      const dbTech:any=dbById.get(String(tech.id))||{};\n      return {...dbTech,id:tech.id,name:tech.name,region:tech.region,active:dbTech.active??true,pin:dbTech.pin??null,specialties:dbTech.specialties??[]};\n    });\n    const extraFromDb=dbRows.filter((row:any)=>!rosterIds.has(String(row.id))&&row.active!==false).map((row:any)=>({...row,active:row.active??true,pin:row.pin??null,specialties:row.specialties??[]}));\n    normalized.push(...extraFromDb);";
if (!s.includes(old)) { console.log('ABORTADO: no se encontro el texto exacto. Nada cambiado.'); process.exit(1); }
fs.writeFileSync(f + '.bak', fs.readFileSync(f));
s = s.replace(old, neu);
fs.writeFileSync(f, s);
console.log('OK: cambio aplicado. Respaldo en ' + f + '.bak');
