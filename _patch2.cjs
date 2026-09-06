const fs = require('fs');
const f = 'src/features/supervisor/pages/SupervisorPortal.tsx';
let s = fs.readFileSync(f, 'utf8');
const changes = [
  ['{dbTechs.filter(tt=>tt.pin).length}/{regionTechs.length} con PIN', '{dbTechs.filter(tt=>tt.pin).length}/{dbTechs.length} con PIN'],
  ['{regionTechs.map(tech=>{', '{dbTechs.map((tech:any)=>{'],
];
let ok = 0, fail = [];
for (const [old, neu] of changes) {
  if (s.includes(old)) { s = s.replace(old, neu); ok++; }
  else fail.push(old);
}
if (fail.length) { console.log('ABORTADO. No encontrados:'); fail.forEach(x => console.log('  - ' + x)); process.exit(1); }
fs.writeFileSync(f + '.bak2', fs.readFileSync(f));
fs.writeFileSync(f, s);
console.log('OK: ' + ok + ' cambios aplicados. Respaldo en ' + f + '.bak2');
