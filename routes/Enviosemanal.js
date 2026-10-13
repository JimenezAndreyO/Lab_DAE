const nodemailer = require('nodemailer');
const cron = require('node-cron');
const almacen = require('./Almacen');

const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// La semana se considera terminada el sábado a las 12:00 pm (hora de Costa Rica, UTC-6),
// porque el último bloque del sábado termina a las 11:40 am.
const HORA_FIN_SEMANA = '12:00:00-06:00';

let enviando = false;

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function iso(dt) {
  return dt.toISOString().slice(0, 10);
}
function lunesDe(fechaStr) {
  const [y, m, d] = fechaStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
  return dt;
}
function finDeSemana(lunes) {
  const sabado = new Date(lunes);
  sabado.setUTCDate(sabado.getUTCDate() + 5);
  return new Date(`${iso(sabado)}T${HORA_FIN_SEMANA}`);
}
function fechaCorta(dt) {
  return `${dt.getUTCDate()} ${MESES[dt.getUTCMonth()]}`;
}

function crearTransporte() {
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: SMTP_SECURE === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

function armarCorreo(lunes, claves, reservas) {
  const sabado = new Date(lunes);
  sabado.setUTCDate(sabado.getUTCDate() + 5);
  const rango = `${fechaCorta(lunes)} – ${fechaCorta(sabado)} ${sabado.getUTCFullYear()}`;

  const filas = claves.sort().map(clave => {
    const [fecha, id] = clave.split('|');
    const [y, m, d] = fecha.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return {
      dia: `${DIAS[(dt.getUTCDay() + 6) % 7]} ${d} ${MESES[m - 1]}`,
      hora: almacen.BLOQUES[id].etiqueta,
      ...reservas[clave],
    };
  });

  const texto = filas
    .map(f => `${f.dia} · ${f.hora}\n  Curso: ${f.curso}\n  Profesor: ${f.profesor}${f.nota ? `\n  Nota: ${f.nota}` : ''}`)
    .join('\n\n');

  const html = `
    <h2>Resumen semanal: ${rango}</h2>
    <table cellpadding="8" cellspacing="0" style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
      <tr style="background:#f1f3f9;text-align:left">
        <th>Día</th><th>Horario</th><th>Curso</th><th>Profesor</th><th>Nota</th>
      </tr>
      ${filas.map(f => `
      <tr style="border-top:1px solid #e3e6ef">
        <td>${esc(f.dia)}</td><td>${esc(f.hora)}</td><td>${esc(f.curso)}</td>
        <td>${esc(f.profesor)}</td><td>${esc(f.nota || '')}</td>
      </tr>`).join('')}
    </table>`;

  return { asunto: `Resumen semanal: ${rango}`, texto: `Resumen semanal: ${rango}\n\n${texto}`, html };
}

async function revisar() {
  if (enviando) return;
  enviando = true;
  try {
    const destinatarios = (process.env.MAIL_DESTINATARIOS || '')
      .split(',').map(s => s.trim()).filter(Boolean);
    const transporte = crearTransporte();
    if (!transporte || destinatarios.length === 0) return;

    const data = almacen.leer();

    // Agrupar bloques por semana (lunes)
    const semanas = {};
    for (const clave of Object.keys(data.reservas)) {
      const lunes = iso(lunesDe(clave.split('|')[0]));
      (semanas[lunes] = semanas[lunes] || []).push(clave);
    }

    for (const [lunesStr, claves] of Object.entries(semanas)) {
      const lunes = lunesDe(lunesStr);
      if (data.enviadas.includes(lunesStr)) continue;
      if (finDeSemana(lunes) > new Date()) continue; // la semana aún no termina

      const correo = armarCorreo(lunes, claves, data.reservas);
      await transporte.sendMail({
        from: process.env.MAIL_REMITENTE || process.env.SMTP_USER,
        to: destinatarios.join(', '),
        subject: correo.asunto,
        text: correo.texto,
        html: correo.html,
      });

      data.enviadas.push(lunesStr);
      almacen.escribir(data);
      console.log(`Correo semanal enviado (${lunesStr})`);
    }
  } catch (err) {
    console.error('Error en el envío semanal:', err.message);
  } finally {
    enviando = false;
  }
}

function iniciar() {
  if (!process.env.SMTP_HOST || !process.env.MAIL_DESTINATARIOS) {
    console.warn('Envío semanal desactivado: faltan SMTP_* o MAIL_DESTINATARIOS en el .env');
    return;
  }
  // Revisa cada 15 minutos; así también se recupera si el servidor estuvo apagado.
  cron.schedule('*/15 * * * *', revisar, { timezone: 'America/Costa_Rica' });
  revisar();
}

module.exports = { iniciar, revisar };