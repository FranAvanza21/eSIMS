const dns      = require('dns');
dns.setDefaultResultOrder('ipv4first'); // evitar ENETUNREACH con registros AAAA de Supabase

const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const { Pool }   = require('pg');
const { Resend } = require('resend');
const session    = require('express-session');
const PgSession  = require('connect-pg-simple')(session);
const bcrypt     = require('bcryptjs');

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
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

async function bootstrapAdmin() {
  if (!process.env.ADMIN_USER || !process.env.ADMIN_PASSWORD) return;
  const { rowCount } = await pool.query('SELECT 1 FROM users LIMIT 1');
  if (rowCount > 0) return;
  const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
  await pool.query(
    'INSERT INTO users (username, password_hash) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [process.env.ADMIN_USER, hash]
  );
  console.log(`Usuario admin "${process.env.ADMIN_USER}" creado.`);
}

initDB()
  .then(bootstrapAdmin)
  .catch(err => console.error('DB init error:', err));

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

app.set('trust proxy', 1); // Render usa HTTPS proxy

app.use(session({
  store: new PgSession({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'dev-secret-cambiar-en-produccion',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 8 * 60 * 60 * 1000, // 8 horas
  },
}));

app.use(express.json({ limit: '5mb' }));

// ── Auth ──────────────────────────────────────────────────────────

app.get('/api/me', (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'No autenticado' });
  res.json({ username: req.session.username });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) return res.status(400).json({ error: 'Credenciales requeridas.' });
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE username=$1', [username]);
    const user = rows[0];
    if (!user || !await bcrypt.compare(password, user.password_hash)) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    }
    req.session.userId   = user.id;
    req.session.username = user.username;
    res.json({ ok: true, username: user.username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.clearCookie('connect.sid').json({ ok: true }));
});

// Proteger todas las rutas /api/* excepto login y me
app.use('/api', (req, res, next) => {
  const publica = ['/login', '/me'];
  if (publica.includes(req.path)) return next();
  if (!req.session?.userId) return res.status(401).json({ error: 'No autenticado' });
  next();
});

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

app.post('/api/esims/bulk', async (req, res) => {
  const { esims } = req.body;
  if (!Array.isArray(esims) || !esims.length) {
    return res.status(400).json({ error: 'Se requiere un array "esims".' });
  }
  const now = Date.now();
  const ids      = esims.map((_, i) => `esim-${now}-${i}`);
  const iccids   = esims.map(e => e.iccid);
  const srvs     = esims.map(e => e.servidor);
  const claves   = esims.map(e => e.clave);
  const pins     = esims.map(e => e.pin);
  const puks     = esims.map(e => e.puk);
  try {
    const { rowCount } = await pool.query(
      `INSERT INTO esims (id, iccid, estado, servidor, clave, pin, puk)
       SELECT * FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[],$7::text[])
         AS t(id,iccid,estado,servidor,clave,pin,puk)
       ON CONFLICT (iccid) DO NOTHING`,
      [ids, iccids, Array(esims.length).fill('free'), srvs, claves, pins, puks]
    );
    res.json({ inserted: rowCount });
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
