const fs = require('fs');
const path = require('path');

const ARCHIVO = path.join(__dirname, 'data', 'reservas.json');

// Bloques válidos y en qué días existen (0 = lunes ... 5 = sábado)
const BLOQUES = {
  b1: { etiqueta: '8:00 – 9:40 am',  dias: [0, 1, 2, 3, 4, 5] },
  b2: { etiqueta: '9:40 – 11:40 am', dias: [0, 1, 2, 3, 4, 5] },
  b3: { etiqueta: '1:00 – 2:40 pm',  dias: [0, 1, 2, 3, 4] },
  b4: { etiqueta: '2:40 – 4:40 pm',  dias: [0, 1, 2, 3, 4] },
  b5: { etiqueta: '6:00 – 7:40 pm',  dias: [0, 1, 2, 3, 4] },
  b6: { etiqueta: '7:40 – 9:30 pm',  dias: [0, 1, 2, 3, 4] },
};

// Estructura: { reservas: { "2026-10-12|b1": { profesor, curso, nota } }, enviadas: ["2026-10-12"] }
function leer() {
  try {
    const d = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'));
    return { reservas: d.reservas || {}, enviadas: d.enviadas || [] };
  } catch (e) {
    if (e.code === 'ENOENT') return { reservas: {}, enviadas: [] };
    throw e; // archivo dañado: no lo sobrescribimos para no perder datos
  }
}

function escribir(data) {
  fs.mkdirSync(path.dirname(ARCHIVO), { recursive: true });
  const tmp = ARCHIVO + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, ARCHIVO);
}

module.exports = { BLOQUES, leer, escribir };