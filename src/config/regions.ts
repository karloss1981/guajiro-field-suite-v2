export const REGION_LABELS: Record<string, { name: string; emoji: string; color: string; sub: string }> = {
  miami: { name: 'Miami', emoji: '🌴', color: '#00b8f5', sub: 'Miami-Dade & Broward' },
  swfl: { name: 'SW Florida', emoji: '🌊', color: '#00dc85', sub: 'Lee, Collier & Charlotte' },
};

export const TECHS_MIAMI = [
  { id: '6017', name: 'Rayner Hernandez', region: 'miami' },
  { id: '6053', name: 'Jorge Luis', region: 'miami' },
  { id: '7010', name: 'George Santiago', region: 'miami' },
  { id: '7065', name: 'Felix Roque', region: 'miami' },
  { id: '7077', name: 'Maykel Lopez Morales', region: 'miami' },
  { id: '7102', name: 'Yandy Gonzalez', region: 'miami' },
  { id: '7113', name: 'Vladimir Pujol', region: 'miami' },
  { id: '7137', name: 'Camilo Harrison', region: 'miami' },
  { id: '7163', name: 'Alberto Amaya', region: 'miami' },
  { id: '7164', name: 'Omar Bernton', region: 'miami' },
  { id: '7191', name: 'Wilfredo Herrera', region: 'miami' },
  { id: '7235', name: 'Bernal Hernandez', region: 'miami' },
  { id: '7260', name: 'Anier Villar', region: 'miami' },
  { id: '7270', name: 'Julio Florez', region: 'miami' },
  { id: '7272', name: 'Renier Gonzalez', region: 'miami' },
  { id: '7377', name: 'Alberto Denis Marichal', region: 'miami' },
  { id: '7419', name: 'Juan Guillermo Aranda', region: 'miami' },
  { id: '7644', name: 'Juan Trujillo', region: 'miami' },
  { id: '7974', name: 'Droo Pool', region: 'miami' },
  { id: '8723', name: 'Onil Perez', region: 'miami' },
  { id: '8799', name: 'Michel Santana', region: 'miami' },
  { id: '8804', name: 'Yunior Barba', region: 'miami' },
  { id: '8807', name: 'Idan Caballero', region: 'miami' },
];

export const TECHS_SWFL = [
  { id: '7004', name: 'Antonio Alfonso Lopez', region: 'swfl' },
  { id: '7006', name: 'Marco Del Aguila', region: 'swfl' },
  { id: '7009', name: 'Jose Del Aguila', region: 'swfl' },
  { id: '7011', name: 'Antonio Montero Hernandez', region: 'swfl' },
  { id: '7112', name: 'Maria Angelica Buitrago', region: 'swfl' },
  { id: '7133', name: 'Yadiel Quintero Garcia', region: 'swfl' },
  { id: '7176', name: 'Michael Astrain Subiador', region: 'swfl' },
  { id: '7225', name: 'Cesar E Quinonez', region: 'swfl' },
  { id: '7234', name: 'Lazaro Prada Martinez', region: 'swfl' },
  { id: '7255', name: 'Dianesky S Echavarria H', region: 'swfl' },
  { id: '7266', name: 'Adrian Rengifo Enrique', region: 'swfl' },
  { id: '7273', name: 'Patrick Edward Jr Seymour', region: 'swfl' },
  { id: '7284', name: 'Yasmani Suares', region: 'swfl' },
  { id: '7318', name: 'Wilka Garcia Reyes', region: 'swfl' },
  { id: '7325', name: 'Yuniel Dorvigny D', region: 'swfl' },
  { id: '7328', name: 'Oscar Chacon Jerez', region: 'swfl' },
  { id: '7348', name: 'Daniel Seibert', region: 'swfl' },
  { id: '7361', name: 'Jose Alfredo Aguila Ulloa', region: 'swfl' },
  { id: '7368', name: 'Michel Ontivero Diaz', region: 'swfl' },
  { id: '7373', name: 'Javier Gonzalo Hernandez Ladino', region: 'swfl' },
  { id: '7374', name: 'Pedro Luis Argudin Mojena', region: 'swfl' },
  { id: '7395', name: 'Stephano Diaz Hernandez', region: 'swfl' },
  { id: '7644', name: 'Juan Alberto Trujillo Diaz', region: 'swfl' },
  { id: '7708', name: 'Eloy Suarez Mouriz', region: 'swfl' },
  { id: '7754', name: 'Erick Rodriguez Pasto', region: 'swfl' },
  { id: '8072', name: 'Edey Ladron De Guevara', region: 'swfl' },
  { id: '8159', name: 'Juan Torres Mitjans', region: 'swfl' },
  { id: '8377', name: 'Luis Acosta Valdes', region: 'swfl' },
  { id: '8405', name: 'Maikel Garcia Moreno', region: 'swfl' },
  { id: '8514', name: 'Jose Torres Padron', region: 'swfl' },
];

export const TECHS = [...TECHS_MIAMI, ...TECHS_SWFL];

export const getTechsByRegion = (region: string) =>
  region === 'swfl' ? TECHS_SWFL : TECHS_MIAMI;

export const getTechName = (id: string) =>
  TECHS.find(t => t.id === String(id))?.name || String(id);

export const PAY_CODES = [
  { code: '601', label: '601 — 0-300ft', total: 100 },
  { code: '873', label: '873 — Sin tubería', total: 45 },
  { code: '874', label: '874 — 300-400ft', total: 130 },
  { code: '875', label: '875 — 400-500ft', total: 160 },
  { code: '876', label: '876 — 500-600ft', total: 200 },
  { code: '877', label: '877 — 600-700ft', total: 200 },
  { code: '878', label: '878 — 700-800ft', total: 200 },
  { code: '879', label: '879 — 800-900ft', total: 200 },
  { code: 'D10', label: 'D10 — 1000-1100ft', total: 250 },
  { code: 'D15', label: 'D15 — 1100-1200ft', total: 250 },
  { code: 'D20', label: 'D20 — 1200ft+', total: 300 },
  { code: 'SQFT', label: 'Corte por sqft', total: 0, needsFt: true, unit: 'sqft' },
  { code: 'CRUCE', label: 'Cruce de calle', total: 0, needsFt: true, unit: 'ft' },
];

export const REASONS_LIST = [
  { id: 'aerial', label: 'Aéreo', emoji: '🔌', color: '#ff5a1f' },
  { id: 'gate', label: 'Gate Cerrado', emoji: '🔒', color: '#ff3348' },
  { id: 'absent', label: 'Customer Ausente', emoji: '🏠', color: '#9d5fff' },
  { id: '811', label: 'Necesita 811', emoji: '⚠️', color: '#ffbe00' },
  { id: 'nocut', label: 'No Quiere Corte', emoji: '🚫', color: '#f43f5e' },
  { id: 'hoa', label: 'Permiso HOA', emoji: '🏢', color: '#8b5cf6' },
  { id: 'missile', label: 'Necesita Misil', emoji: '🎯', color: '#06b6d4' },
  { id: 'machine', label: 'Requiere Máquina', emoji: '🚜', color: '#f97316' },
  { id: 'twomen', label: 'Requiere 2 Técnicos', emoji: '👥', color: '#10b981' },
  { id: 'neighbor', label: 'Vecino No Disponible', emoji: '🏘️', color: '#64748b' },
  { id: 'cancelled', label: 'Cliente Canceló', emoji: '❌', color: '#ff3348' },
  { id: 'notime', label: 'No Me Dio el Tiempo', emoji: '⏰', color: '#eab308' },
  { id: 'construct', label: 'En Construcción', emoji: '🏗️', color: '#a78bfa' },
  { id: 'obstacle', label: 'Obstáculo / Bloqueo', emoji: '🚧', color: '#00e0d4' },
  { id: 'duplicate', label: 'Duplicado / Ya Hecho', emoji: '✅', color: '#22d3ee' },
  { id: 'mdu', label: 'MDU', emoji: '🏗️', color: '#0ea5e9' },
  { id: 'other', label: 'Otro', emoji: '📝', color: '#5a7aaa' },
];

export const NOTE_TYPES: Record<string, { label: string; color: string; bg: string; border: string; icon: string }> = {
  recommendation: { label: 'Recomendación', color: '#00dc85', bg: '#00dc8518', border: '#00dc8544', icon: '💡' },
  mandatory: { label: 'Obligatorio', color: '#ff3348', bg: '#ff334818', border: '#ff334844', icon: '🚨' },
  urgent: { label: 'URGENTE', color: '#ffbe00', bg: '#ffbe0018', border: '#ffbe0044', icon: '⚡' },
};

export const MIAMI_DADE_ZIPS = new Set([
  '33010','33011','33012','33013','33014','33015','33016','33017','33018',
  '33030','33031','33032','33033','33034','33035','33039',
  '33054','33055','33056',
  '33101','33109','33110','33111','33112','33114','33116','33119',
  '33122','33125','33126','33127','33128','33129',
  '33130','33131','33132','33133','33134','33135','33136','33137','33138','33139',
  '33140','33141','33142','33143','33144','33145','33146','33147','33149',
  '33150','33151','33152','33153','33154','33155','33156','33157','33158','33159',
  '33160','33161','33162','33163','33164','33165','33166','33167','33168','33169',
  '33170','33172','33173','33174','33175','33176','33177','33178','33179',
  '33180','33181','33182','33183','33184','33185','33186','33187','33188','33189',
  '33190','33192','33193','33194','33195','33196',
]);

export const BROWARD_ZIPS = new Set([
  '33004','33009','33019','33020','33021','33022','33023','33024','33025','33026','33027','33028','33029',
  '33060','33061','33062','33063','33064','33065','33066','33067','33068','33069',
  '33071','33073','33074','33075','33076','33077',
  '33301','33302','33303','33304','33305','33306','33307','33308','33309','33310',
  '33311','33312','33313','33314','33315','33316','33317','33318','33319',
  '33320','33321','33322','33323','33324','33325','33326','33327','33328','33329',
  '33330','33331','33332','33334',
  '33388','33394',
]);

export const JOB_NOTES_ES = [
  '✅ Trabajo realizado correctamente, hice contacto con el cliente',
  '✅ Trabajo realizado correctamente, no pude hacer contacto con el cliente',
];

export const JOB_NOTES_EN = [
  '✅ Job completed correctly, I made contact with the customer',
  '✅ Job completed correctly, no contact with customer',
];
