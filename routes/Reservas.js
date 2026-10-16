const crypto = require('crypto');
const express = require('express');
const almacen = require('./Almacen');

const router = express.Router();
router.use(express.json());

const CLAVE_BLOQUE = /^(\d{4})-(\d{2})-(\d{2})\|(b[1-6])$/;
const MIN_CLAVE = 4;

// Interruptor de claves: false = cualquiera puede editar/eliminar (modo desarrollo),
// true = hace falta la clave del bloque. Cámbialo y reinicia el servidor.
const USAR_CLAVES = true;

function claveValida(clave) {
  const m = CLAVE_BLOQUE.exec(clave);
  if (!m) return false;
  const [, y, mo, d, id] = m;
  const dt = new Date(Date.UTC(+y, +mo - 1, +d));
  if (dt.getUTCFullYear() !== +y || dt.getUTCMonth() !== +mo - 1 || dt.getUTCDate() !== +d) return false;
  const dow = (dt.getUTCDay() + 6) % 7; // lunes = 0
  return almacen.BLOQUES[id].dias.includes(dow);
}

function limpiar(valor, max) {
  return String(valor ?? '').trim().slice(0, max);
}

// ---------- Bloques pasados (bloqueados) ----------
// Hora a la que termina cada bloque (24 h, hora de Costa Rica)
const FIN_BLOQUE = { b1: '09:40', b2: '11:40', b3: '14:40', b4: '16:40', b5: '19:40', b6: '21:30' };

const MENSAJE_PASADO = 'No se pueden agregar, editar ni eliminar bloques que ya pasaron.';

// Un bloque ya pasó si su día es anterior a hoy, o si es hoy y ya terminó.
// Hora de Costa Rica = UTC-6 (sin horario de verano).
function esBloquePasado(clave) {
  const [fecha, id] = String(clave).split('|');
  const ahora = new Date(Date.now() - 6 * 3600 * 1000).toISOString(); // "YYYY-MM-DDTHH:MM:..."
  const hoy = ahora.slice(0, 10);
  const hora = ahora.slice(11, 16);
  if (fecha < hoy) return true;
  return fecha === hoy && Boolean(FIN_BLOQUE[id]) && FIN_BLOQUE[id] <= hora;
}

// ---------- Claves (se guardan cifradas, nunca en texto plano) ----------
function hacerHash(clave) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(clave, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function comprobar(clave, guardado) {
  const [salt, hash] = String(guardado).split(':');
  if (!salt || !hash) return false;
  const calculado = crypto.scryptSync(clave, salt, 32);
  const esperado = Buffer.from(hash, 'hex');
  return esperado.length === calculado.length && crypto.timingSafeEqual(calculado, esperado);
}

// Clave maestra opcional (ADMIN_CLAVE en el .env) para resolver conflictos o claves olvidadas
function esAdmin(clave) {
  const admin = process.env.ADMIN_CLAVE;
  if (!admin) return false;
  const a = crypto.createHash('sha256').update(clave).digest();
  const b = crypto.createHash('sha256').update(admin).digest();
  return crypto.timingSafeEqual(a, b);
}

// ---------- Límite de intentos fallidos (en memoria) ----------
const fallos = new Map();
const MAX_FALLOS = 5;
const VENTANA_MS = 5 * 60 * 1000;

function demasiadosFallos(k) {
  const f = fallos.get(k);
  if (!f) return false;
  if (Date.now() - f.desde > VENTANA_MS) { fallos.delete(k); return false; }
  return f.n >= MAX_FALLOS;
}
function registrarFallo(k) {
  const f = fallos.get(k);
  if (!f || Date.now() - f.desde > VENTANA_MS) fallos.set(k, { n: 1, desde: Date.now() });
  else f.n++;
}

// Devuelve true si se puede continuar; si no, ya respondió al cliente.
// Los bloques sin clave (antiguos o inexistentes) se pueden modificar libremente.
function autorizar(req, res, reserva) {
  if (!USAR_CLAVES || !reserva || !reserva.claveHash) return true;

  const k = `${req.ip}|${req.params.clave}`;
  if (demasiadosFallos(k)) {
    res.status(429).json({ error: 'Demasiados intentos fallidos. Espera unos minutos.' });
    return false;
  }

  const clave = limpiar((req.body || {}).clave, 40);
  if (clave && (esAdmin(clave) || comprobar(clave, reserva.claveHash))) return true;

  registrarFallo(k);
  res.status(403).json({ error: 'Clave incorrecta. Solo quien creó el bloque puede modificarlo.' });
  return false;
}

// Nunca se envían claves ni IP al navegador
function publica(reserva) {
  const { claveHash, ip, ...resto } = reserva;
  return resto;
}

// ---------- Rutas ----------
// La vista consulta esto para saber si debe mostrar el campo de clave
router.get('/config', (req, res) => {
  res.json({ claves: USAR_CLAVES });
});

router.get('/', (req, res) => {
  const reservas = almacen.leer().reservas;
  const salida = {};
  for (const [clave, r] of Object.entries(reservas)) salida[clave] = publica(r);
  res.json(salida);
});

// Crear o editar un bloque
router.put('/:clave', (req, res) => {
  const clave = req.params.clave;
  if (!claveValida(clave)) return res.status(400).json({ error: 'Bloque inválido' });
  if (esBloquePasado(clave)) return res.status(403).json({ error: MENSAJE_PASADO });

  const body = req.body || {};
  const profesor = limpiar(body.profesor, 80);
  const curso = limpiar(body.curso, 80);
  const nota = limpiar(body.nota, 300);
  if (!profesor || !curso) {
    return res.status(400).json({ error: 'Profesor y curso son obligatorios' });
  }

  const data = almacen.leer();
  const existente = data.reservas[clave];
  if (!autorizar(req, res, existente)) return;

  let claveHash = existente && existente.claveHash;
  if (USAR_CLAVES && !claveHash) {
    const nueva = limpiar(body.clave, 40);
    if (nueva.length < MIN_CLAVE) {
      return res.status(400).json({ error: `La clave debe tener al menos ${MIN_CLAVE} caracteres` });
    }
    claveHash = hacerHash(nueva);
  }

  data.reservas[clave] = { profesor, curso, nota, claveHash };
  almacen.escribir(data);
  res.json(publica(data.reservas[clave]));
});

// Eliminar un bloque (requiere la clave en el cuerpo: { clave })
router.delete('/:clave', (req, res) => {
  if (esBloquePasado(req.params.clave)) return res.status(403).json({ error: MENSAJE_PASADO });

  const data = almacen.leer();
  if (!autorizar(req, res, data.reservas[req.params.clave])) return;

  delete data.reservas[req.params.clave];
  almacen.escribir(data);
  res.json({ ok: true });
});

module.exports = router;