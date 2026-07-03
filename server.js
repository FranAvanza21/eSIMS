const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const { Pool } = require('pg');
const { Resend } = require('resend');

const app    = express();
const resend = new Resend(process.env.RESEND_API_KEY);
const PORT   = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS esims (
      id          TEXT PRIMARY KEY,
      iccid       TEXT NOT NULL UNIQUE,
      estado      TEXT NOT NULL DEFAULT 'free',
      servidor    TEXT,
      clave       TEXT,
      pin         TEXT,
      puk         TEXT,
      id_cliente  INTEGER,
      email       TEXT,
      fecha_usado DATE
    );
    CREATE TABLE IF NOT EXISTS email_logs (
      id         SERIAL PRIMARY KEY,
      iccid      TEXT NOT NULL,
      to_email   TEXT NOT NULL,
      sent_at    TIMESTAMPTZ DEFAULT NOW(),
      resend_id  TEXT,
      ok         BOOLEAN NOT NULL,
      error_msg  TEXT
    );
  `);
}

initDB().catch(err => console.error('DB init error:', err));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'none'; " +
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
    "font-src https://cdn.jsdelivr.net; " +
    "connect-src 'self' https://sia.avanzasolutions.es; " +
    "img-src 'self' data:; " +
    "frame-ancestors 'none';"
  );
  next();
});

app.use((req, res, next) => {
  if (/\/\./.test(req.path)) return res.status(404).end();
  next();
});

app.use(express.json({ limit: '5mb' }));
app.use(express.static(__dirname, { index: 'esims.html' }));

// ── CRUD eSIMs ────────────────────────────────────────────────────

app.get('/api/esims', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM esims ORDER BY iccid');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/esims', async (req, res) => {
  const { id, iccid, estado, servidor, clave, pin, puk, id_cliente, email, fecha_usado } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO esims (id, iccid, estado, servidor, clave, pin, puk, id_cliente, email, fecha_usado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [id, iccid, estado ?? 'free', servidor, clave, pin, puk, id_cliente ?? null, email ?? null, fecha_usado ?? null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/esims/:id', async (req, res) => {
  const { iccid, estado, servidor, clave, pin, puk, id_cliente, email, fecha_usado } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE esims SET iccid=$1, estado=$2, servidor=$3, clave=$4, pin=$5,
       puk=$6, id_cliente=$7, email=$8, fecha_usado=$9
       WHERE id=$10 RETURNING *`,
      [iccid, estado, servidor, clave, pin, puk, id_cliente ?? null, email ?? null, fecha_usado ?? null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'eSIM no encontrada' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/esims/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM esims WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'eSIM no encontrada' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Envío de correo ───────────────────────────────────────────────

app.post('/api/send-email', async (req, res) => {
  const { to, iccid, nombre, qrBase64 } = req.body ?? {};

  if (!to || !iccid || !qrBase64) {
    return res.status(400).json({ error: 'Faltan campos: to, iccid, qrBase64.' });
  }

  let htmlBody;
  try {
    const tpl = fs.readFileSync(path.join(__dirname, 'email-activacion.html'), 'utf8');
    const qrImg = `<img src="data:image/png;base64,${qrBase64}" width="200" height="200"
      alt="Código QR de activación"
      style="display:block;margin:0 auto;border:0;outline:none;">`;
    htmlBody = tpl
      .replace(/\{\{NOMBRE\}\}/g,   nombre || 'Cliente')
      .replace(/\{\{ICCID\}\}/g,    iccid)
      .replace(/\{\{QR_IMAGE\}\}/g, qrImg);
  } catch {
    return res.status(500).json({ error: 'No se pudo cargar la plantilla de correo.' });
  }

  let resendId = null;
  let ok = false;
  let errorMsg = null;

  try {
    const { data, error } = await resend.emails.send({
      from:    'AVANZA FIBRA <noreply@avanzasolutions.es>',
      to:      [to],
      subject: `Tu eSIM AVANZA FIBRA está lista — Nº ${iccid}`,
      html:    htmlBody,
    });
    if (error) throw new Error(error.message);
    resendId = data.id;
    ok = true;
  } catch (err) {
    errorMsg = err.message;
  }

  const iccidRaw = iccid.replace(/\s/g, '');
  await pool.query(
    `INSERT INTO email_logs (iccid, to_email, resend_id, ok, error_msg) VALUES ($1,$2,$3,$4,$5)`,
    [iccidRaw, to, resendId, ok, errorMsg]
  ).catch(() => {});

  if (!ok) return res.status(500).json({ error: errorMsg });
  res.json({ ok: true, id: resendId });
});

app.listen(PORT, () => console.log(`eSIMS server listening on :${PORT}`));
