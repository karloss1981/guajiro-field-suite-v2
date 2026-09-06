const fs = require('fs');
const f = 'src/features/supervisor/pages/SupervisorPortal.tsx';
let s = fs.readFileSync(f, 'utf8');
const changes = [
  ['{regionTechs.map((tc:any)=><option key={tc.id} value={tc.id}>{tc.id} — {tc.name}</option>)}', '{dbTechs.map((tc:any)=><option key={tc.id} value={tc.id}>{tc.id} — {tc.name}</option>)}'],
  ['{regionTechs.filter((tc:any)=>tc.id!==bulkReassignFrom)', '{dbTechs.filter((tc:any)=>tc.id!==bulkReassignFrom)'],
];
let ok = 0, fail = [];
for (const [old, neu] of changes) {
  if (s.includes(old)) { s = s.replace(old, neu); ok++; }
  else fail.push(old);
}
if (fail.length) { console.log('ABORTADO. No encontrados:'); fail.forEach(x => console.log('  - ' + x)); process.exit(1); }
fs.writeFileSync(f + '.bak3', fs.readFileSync(f));
fs.writeFileSync(f, s);
console.log('OK: ' + ok + ' cambios aplicados. Respaldo en ' + f + '.bak3');
