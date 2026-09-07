const dns      = require('dns');
dns.setDefaultResultOrder('ipv4first'); // evitar ENETUNREACH con registros AAAA de Supabase

const crypto   = require('crypto');

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
    ALTER TABLE esims ADD COLUMN IF NOT EXISTS telefono TEXT;
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
    ALTER TABLE users ADD COLUMN IF NOT EXISTS oidc_sub TEXT UNIQUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS rol TEXT NOT NULL DEFAULT 'usuario';
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_rol_check') THEN
        ALTER TABLE users ADD CONSTRAINT users_rol_check CHECK (rol IN ('admin','usuario'));
      END IF;
    END $$;
  `);
}

initDB()
  .catch(err => console.error('DB init error:', err));

// ── OIDC / Authentik ──────────────────────────────────────────────
// Interruptor: sin NINGUNA variable OIDC_*, la app arranca exactamente como
// antes de existir este bloque. Con algunas pero no todas, el arranque falla
// nombrando la que falta: media configuración es alguien que se cree configurado.

const OIDC_VARS = ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI'];
const oidcPuestas = OIDC_VARS.filter(v => process.env[v]);
const OIDC_CONFIGURADO = oidcPuestas.length > 0;

if (OIDC_CONFIGURADO && oidcPuestas.length < OIDC_VARS.length) {
  const faltan = OIDC_VARS.filter(v => !process.env[v]);
  console.error(`Configuración OIDC incompleta: falta ${faltan.join(', ')}`);
  process.exit(1);
}

// Vinculación por correo cuando Authentik manda email_verified:false (que es lo
// que hace). Por defecto NO se vincula. Ver PLAN-AUTHENTIK.md §5: activarla solo
// es seguro mientras los usuarios no puedan editar su propio correo en Authentik.
const VINCULAR_SIN_EMAIL_VERIFICADO =
  process.env.OIDC_VINCULAR_SIN_EMAIL_VERIFICADO === 'true';

let oidc       = null; // módulo openid-client (ESM, cargado con import dinámico)
let oidcConfig = null; // Configuration del discovery; null = OIDC no operativo

async function initOIDC() {
  if (!OIDC_CONFIGURADO) return;
  oidc = await import('openid-client');
  oidcConfig = await oidc.discovery(
    new URL(process.env.OIDC_ISSUER),
    process.env.OIDC_CLIENT_ID,
    process.env.OIDC_CLIENT_SECRET
  );
  console.log(`OIDC activo — redirect_uri: ${process.env.OIDC_REDIRECT_URI}`);
  console.log('OIDC — la redirect_uri debe coincidir EXACTAMENTE con la de Authentik.');
  if (!VINCULAR_SIN_EMAIL_VERIFICADO) {
    console.log('OIDC — OIDC_VINCULAR_SIN_EMAIL_VERIFICADO=false: solo entrará quien ya tenga oidc_sub.');
  }
}

// Un fallo aquí NO puede tumbar la aplicación: Authentik es la única vía de
// acceso, así que si el discovery falla, /auth/oidc/login lo reintentará en
// la siguiente petición en vez de dejar el proceso caído.
initOIDC().catch(err => {
  oidcConfig = null;
  console.error('OIDC desactivado — el discovery falló:', err.message);
  console.error('Nadie podrá iniciar sesión hasta que Authentik esté disponible de nuevo.');
});

// Cache en memoria para QRs pendientes de entregar por correo
const qrCache = new Map();

// QR temporal — sin CSP ni auth (URL opaca con ICCID como clave)
app.get('/qr/:iccid.png', (req, res) => {
  const data = qrCache.get(req.params.iccid);
  if (!data) return res.status(404).end();
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(Buffer.from(data, 'base64'));
});

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
    // 'lax' y no 'strict': la vuelta desde Authentik es una navegación top-level
    // desde otro sitio, y con 'strict' el navegador NO manda la cookie — sin ella
    // no hay ni state ni code_verifier y el callback fallaría siempre.
    // 'lax' sigue sin mandarla en POST/fetch cross-site, así que la protección
    // CSRF de /api/* es la misma. Ver PLAN-AUTHENTIK.md §11.
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000, // 8 horas
  },
}));

app.use(express.json({ limit: '5mb' }));

// ── Auth ──────────────────────────────────────────────────────────

app.get('/api/me', async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'No autenticado' });
  try {
    const { rows } = await pool.query('SELECT id, username, rol FROM users WHERE id=$1', [req.session.userId]);
    // La cuenta ya no existe (la han eliminado): la sesión deja de valer aquí mismo.
    if (!rows.length) {
      return req.session.destroy(() => res.status(401).json({ error: 'No autenticado' }));
    }
    res.json({ id: rows[0].id, username: rows[0].username, rol: rows[0].rol });
  } catch (err) {
    // Si la base de datos falla, se responde con el rol mínimo en vez de 500:
    // la aplicación sigue usable y simplemente no se pinta el panel de administración.
    res.json({ username: req.session.username, rol: 'usuario' });
  }
});

app.post('/api/logout', (req, res) => {
  // Si la sesión vino de Authentik, además hay que cerrar allí. El frontend
  // navega a la URL devuelta; si no la hay, se comporta como siempre.
  const sesionOidc = req.session?.oidc;
  let redirect = null;
  if (sesionOidc?.idToken && oidcConfig) {
    try {
      redirect = oidc.buildEndSessionUrl(oidcConfig, {
        id_token_hint: sesionOidc.idToken,
        post_logout_redirect_uri: new URL('/', process.env.OIDC_REDIRECT_URI).href,
      }).href;
    } catch (err) {
      console.error('OIDC end_session no disponible:', err.message);
    }
  }
  req.session.destroy(() => {
    res.clearCookie('connect.sid').json(redirect ? { ok: true, redirect } : { ok: true });
  });
});

// Proteger todas las rutas /api/* excepto me
app.use('/api', (req, res, next) => {
  const publica = ['/me'];
  if (publica.includes(req.path)) return next();
  if (!req.session?.userId) return res.status(401).json({ error: 'No autenticado' });
  next();
});

// ── Rutas OIDC ────────────────────────────────────────────────────
// Cuelgan de /auth/*, fuera de /api, así que el middleware de arriba ni las ve.
// Solo se registran si hay configuración: sin ella, /auth/oidc/* da 404.

// Página de error propia en lugar de redirigir a /?auth_error=: así se
// devuelve el código HTTP real y no hay que añadir manejo de errores en
// esims.html. Los textos son fijos; el detalle técnico va al log del servidor.
// Estilos en línea: la CSP permite 'unsafe-inline' en style-src.
function paginaError(res, codigo, titulo, detalle) {
  res.status(codigo).type('html').send(`<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo} — AVANZA FIBRA</title>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#0d1f4e; padding:1.5rem 1rem; box-sizing:border-box;
         font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  .caja { background:#fff; border-radius:12px; padding:2.5rem 2rem; max-width:420px; width:100%;
          text-align:center; box-shadow:0 8px 32px rgba(0,0,0,.3); }
  .marca { font-size:1.1rem; font-weight:700; color:#0d1f4e; margin-bottom:1.5rem; }
  .icono { width:48px; height:48px; margin:0 auto 1rem; }
  h1 { font-size:1.15rem; color:#0d1f4e; margin:0 0 .75rem; }
  p  { font-size:.92rem; line-height:1.5; color:#495057; margin:0 0 1.5rem; }
  a  { display:inline-block; background:#0d1f4e; color:#fff; text-decoration:none;
       padding:.6rem 1.4rem; border-radius:8px; font-size:.9rem; font-weight:500; }
</style></head>
<body><div class="caja" role="alert">
  <div class="marca">AVANZA FIBRA</div>
  <svg class="icono" viewBox="0 0 24 24" fill="none" stroke="#b02a37" stroke-width="2"
       stroke-linecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="13"></line>
    <line x1="12" y1="16.5" x2="12.01" y2="16.5"></line>
  </svg>
  <h1>${titulo}</h1>
  <p>${detalle}</p>
  <a href="/">Volver</a>
</div></body></html>`);
}

if (OIDC_CONFIGURADO) {
  app.get('/auth/oidc/login', async (req, res) => {
    if (!oidcConfig) {
      return paginaError(res, 503, 'Acceso con Authentik no disponible',
        'No se ha podido contactar con el proveedor de identidad. Vuelve a intentarlo en unos minutos.');
    }
    try {
      const codeVerifier  = oidc.randomPKCECodeVerifier();
      const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
      const state = oidc.randomState();
      const nonce = oidc.randomNonce();

      req.session.oidcFlow = { state, nonce, codeVerifier };
      // Guardado explícito: sin esperar al store, el 302 puede salir antes de
      // que la sesión esté escrita en Postgres y el callback no encontraría nada.
      req.session.save(err => {
        if (err) {
          console.error('OIDC login — no se pudo guardar la sesión:', err.message);
          return paginaError(res, 500, 'Error al iniciar sesión', 'Vuelve a intentarlo.');
        }
        const url = oidc.buildAuthorizationUrl(oidcConfig, {
          redirect_uri:          process.env.OIDC_REDIRECT_URI,
          scope:                 'openid email profile',
          state,
          nonce,
          code_challenge:        codeChallenge,
          code_challenge_method: 'S256',
        });
        res.redirect(url.href);
      });
    } catch (err) {
      console.error('OIDC login error:', err.message);
      paginaError(res, 500, 'Error al iniciar sesión', 'Vuelve a intentarlo.');
    }
  });

  app.get('/auth/oidc/callback', async (req, res) => {
    if (!oidcConfig) {
      return paginaError(res, 503, 'Acceso con Authentik no disponible',
        'No se ha podido contactar con el proveedor de identidad.');
    }

    const flujo = req.session?.oidcFlow;
    delete req.session?.oidcFlow; // un solo uso, pase lo que pase

    if (!flujo?.state || !req.query.state || req.query.state !== flujo.state) {
      return paginaError(res, 400, 'Solicitud no válida',
        'El inicio de sesión ha caducado o no es válido. Vuelve a intentarlo desde el principio.');
    }

    let claims, tokens;
    try {
      // La URL del canje se construye con OIDC_REDIRECT_URI, NUNCA con req.host:
      // detrás del proxy req.host puede ser el host interno del contenedor.
      const urlActual = new URL(process.env.OIDC_REDIRECT_URI);
      urlActual.search = new URL(req.originalUrl, 'http://interno').search;
      tokens = await oidc.authorizationCodeGrant(oidcConfig, urlActual, {
        pkceCodeVerifier: flujo.codeVerifier,
        expectedState:    flujo.state,
        expectedNonce:    flujo.nonce,
      });
      claims = tokens.claims();
    } catch (err) {
      console.error('OIDC callback — canje o validación fallidos:', err.message);
      return paginaError(res, 400, 'No se pudo completar el inicio de sesión',
        'Vuelve a intentarlo. Si el problema persiste, avisa a Sistemas.');
    }

    const sub   = claims.sub;
    const email = String(claims.email || '').trim().toLowerCase();

    // Resolución de identidad. Orden fijo: primero oidc_sub (inmutable), y solo
    // si no hay, el correo UNA vez, escribiendo el sub para no volver a mirarlo.
    // Nunca al revés: email y preferred_username son mutables desde Authentik.
    let usuario = null;
    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');

      const porSub = await cliente.query('SELECT * FROM users WHERE oidc_sub=$1', [sub]);
      if (porSub.rows.length) {
        usuario = porSub.rows[0];
      } else if (email && (claims.email_verified === true || VINCULAR_SIN_EMAIL_VERIFICADO)) {
        const porEmail = await cliente.query(
          'SELECT * FROM users WHERE lower(username)=$1 FOR UPDATE', [email]
        );
        if (porEmail.rows.length) {
          // AND oidc_sub IS NULL: si otro callback simultáneo ya vinculó esta
          // fila, no se pisa. Devuelve 0 filas y se deniega, que es lo correcto.
          const vinculada = await cliente.query(
            'UPDATE users SET oidc_sub=$1 WHERE id=$2 AND oidc_sub IS NULL RETURNING *',
            [sub, porEmail.rows[0].id]
          );
          usuario = vinculada.rows[0] || null;
          if (usuario) console.log(`OIDC — vinculada por correo la cuenta "${usuario.username}".`);
        }
      }

      await cliente.query('COMMIT');
    } catch (err) {
      await cliente.query('ROLLBACK').catch(() => {});
      console.error('OIDC callback — error resolviendo el usuario:', err.message);
      return paginaError(res, 500, 'Error al iniciar sesión', 'Vuelve a intentarlo.');
    } finally {
      cliente.release();
    }

    if (!usuario) {
      console.warn(`OIDC — acceso DENEGADO, sin cuenta en la aplicación. sub=${sub} email=${email || '(sin correo)'}`);
      return paginaError(res, 403, 'No tienes acceso',
        'Tu cuenta de Avanza es correcta, pero no tiene acceso a Gestión de eSIMs. Habla con tu responsable.');
    }

    // Regenerar antes de rellenar: evita fijación de sesión. Ojo, regenerate()
    // vacía la sesión, así que el flujo ya está leído en variables locales.
    const idToken = tokens.id_token;
    req.session.regenerate(err => {
      if (err) {
        console.error('OIDC callback — regenerate falló:', err.message);
        return paginaError(res, 500, 'Error al iniciar sesión', 'Vuelve a intentarlo.');
      }
      req.session.userId   = usuario.id;
      req.session.username = usuario.username;
      req.session.oidc     = { idToken, sub };
      req.session.save(err2 => {
        if (err2) {
          console.error('OIDC callback — no se pudo guardar la sesión:', err2.message);
          return paginaError(res, 500, 'Error al iniciar sesión', 'Vuelve a intentarlo.');
        }
        res.redirect('/');
      });
    });
  });
}

app.use(express.static(path.join(__dirname, 'public')));
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
  const { id, iccid, estado, servidor, clave, pin, puk, id_cliente, email, telefono, fecha_usado } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO esims (id, iccid, estado, servidor, clave, pin, puk, id_cliente, email, telefono, fecha_usado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [id, iccid, estado ?? 'free', servidor, clave, pin, puk, id_cliente ?? null, email ?? null, telefono ?? null, fecha_usado ?? null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/esims/:id', async (req, res) => {
  const { iccid, estado, servidor, clave, pin, puk, id_cliente, email, telefono, fecha_usado } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE esims SET iccid=$1, estado=$2, servidor=$3, clave=$4, pin=$5,
       puk=$6, id_cliente=$7, email=$8, telefono=$9, fecha_usado=$10
       WHERE id=$11 RETURNING *`,
      [iccid, estado, servidor, clave, pin, puk, id_cliente ?? null, email ?? null, telefono ?? null, fecha_usado ?? null, req.params.id]
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

// ── Administración de usuarios ────────────────────────────────────
// Todo lo de aquí exige rol 'admin'. Cuelga de /api/admin/*, así que el
// middleware de sesión de arriba ya ha exigido estar autenticado.

const ES_CORREO         = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CUENTA_EMERGENCIA = 'admin'; // acceso local que no depende de Authentik

// El rol se relee de la BD en CADA petición, no se toma de la sesión: si a
// alguien se le retira el rol, deja de ser administrador al instante en vez de
// seguir siéndolo hasta que le caduque la sesión de 8 horas.
async function exigirAdmin(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT rol FROM users WHERE id=$1', [req.session.userId]);
    if (!rows.length) {
      return req.session.destroy(() => res.status(401).json({ error: 'No autenticado' }));
    }
    if (rows[0].rol !== 'admin') {
      return res.status(403).json({ error: 'Se requiere rol de administrador.' });
    }
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

const CAMPOS_USUARIO =
  'id, username, rol, (oidc_sub IS NOT NULL) AS vinculado, created_at';

app.get('/api/admin/users', exigirAdmin, async (req, res) => {
  try {
    // Nunca se devuelve password_hash ni oidc_sub, solo si está vinculado o no.
    const { rows } = await pool.query(`SELECT ${CAMPOS_USUARIO} FROM users ORDER BY id`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/users', exigirAdmin, async (req, res) => {
  const username = String(req.body?.username ?? '').trim().toLowerCase();
  const rol      = req.body?.rol === 'admin' ? 'admin' : 'usuario';

  // Tiene que ser un correo: el emparejamiento con Authentik va contra el
  // claim email. Un usuario que no sea un correo no podría entrar nunca.
  if (!ES_CORREO.test(username)) {
    return res.status(400).json({ error: 'El usuario debe ser un correo electrónico.' });
  }
  try {
    // Contraseña local imposible: bcrypt de 64 bytes aleatorios que se descartan.
    // Estas cuentas entran SOLO por Authentik. Mismo criterio que las altas por SQL.
    const hash = await bcrypt.hash(crypto.randomBytes(64).toString('base64'), 10);
    // ON CONFLICT DO NOTHING, nunca DO UPDATE: un upsert le pisaría el hash a
    // quien ya existiera y lo dejaría fuera.
    const { rows } = await pool.query(
      `INSERT INTO users (username, password_hash, rol) VALUES ($1,$2,$3)
       ON CONFLICT (username) DO NOTHING RETURNING ${CAMPOS_USUARIO}`,
      [username, hash, rol]
    );
    if (!rows.length) return res.status(409).json({ error: 'Ese usuario ya existe.' });
    console.log(`ADMIN — "${req.session.username}" da de alta a "${username}" con rol ${rol}.`);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/admin/users/:id', exigirAdmin, async (req, res) => {
  const id  = Number(req.params.id);
  const rol = req.body?.rol;
  if (!['admin', 'usuario'].includes(rol)) return res.status(400).json({ error: 'Rol no válido.' });
  // Quitarse el rol a uno mismo es la forma más fácil de quedarse fuera.
  if (id === req.session.userId) {
    return res.status(400).json({ error: 'No puedes cambiar tu propio rol.' });
  }
  try {
    if (rol === 'usuario') {
      const { rows: admins } = await pool.query("SELECT id FROM users WHERE rol='admin'");
      // Sin administradores no habría forma de administrar desde la aplicación.
      if (admins.length <= 1 && admins.some(a => a.id === id)) {
        return res.status(400).json({ error: 'No puedes quitar el último administrador.' });
      }
    }
    const { rows } = await pool.query(
      `UPDATE users SET rol=$1 WHERE id=$2 RETURNING ${CAMPOS_USUARIO}`, [rol, id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado.' });
    console.log(`ADMIN — "${req.session.username}" cambia el rol de "${rows[0].username}" a ${rol}.`);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/users/:id', exigirAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.session.userId) {
    return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta.' });
  }
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const { rows } = await cliente.query('SELECT username, rol FROM users WHERE id=$1 FOR UPDATE', [id]);
    if (!rows.length) {
      await cliente.query('ROLLBACK');
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }
    if (rows[0].username === CUENTA_EMERGENCIA) {
      await cliente.query('ROLLBACK');
      return res.status(400).json({
        error: 'La cuenta "admin" es el acceso de emergencia y no se elimina desde aquí.',
      });
    }
    if (rows[0].rol === 'admin') {
      const { rowCount } = await cliente.query("SELECT 1 FROM users WHERE rol='admin'");
      if (rowCount <= 1) {
        await cliente.query('ROLLBACK');
        return res.status(400).json({ error: 'No puedes eliminar el último administrador.' });
      }
    }
    await cliente.query('DELETE FROM users WHERE id=$1', [id]);
    // Imprescindible: el middleware de /api solo comprueba que exista
    // req.session.userId, no que la fila siga viva. Sin esto, quien acabas de
    // eliminar seguiría dentro hasta 8 horas después.
    await cliente.query("DELETE FROM session WHERE (sess->>'userId') = $1", [String(id)]);
    await cliente.query('COMMIT');
    console.log(`ADMIN — "${req.session.username}" elimina a "${rows[0].username}" y cierra sus sesiones.`);
    res.json({ ok: true });
  } catch (err) {
    await cliente.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    cliente.release();
  }
});

// ── Envío de correo ───────────────────────────────────────────────

app.post('/api/send-email', async (req, res) => {
  const { to, iccid, nombre, qrBase64, pin, puk, telefono } = req.body ?? {};

  if (!to || !iccid || !qrBase64) {
    return res.status(400).json({ error: 'Faltan campos: to, iccid, qrBase64.' });
  }

  const iccidRaw = iccid.replace(/\s/g, '');
  let htmlBody;
  try {
    const tpl = fs.readFileSync(path.join(__dirname, 'email-activacion.html'), 'utf8');
    qrCache.set(iccidRaw, qrBase64);
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const qrUrl  = `${baseUrl}/qr/${iccidRaw}.png`;
    const qrImg  = `<img src="${qrUrl}" width="200" height="200"
      alt="Código QR de activación"
      style="display:block;margin:0 auto;border:0;outline:none;">`;
    htmlBody = tpl
      .replace(/\{\{NOMBRE\}\}/g,   nombre || 'Cliente')
      .replace(/\{\{ICCID\}\}/g,    iccid)
      .replace(/\{\{TELEFONO\}\}/g, telefono || '—')
      .replace(/\{\{PIN\}\}/g,      pin  || '—')
      .replace(/\{\{PUK\}\}/g,      puk  || '—')
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

  await pool.query(
    `INSERT INTO email_logs (iccid, to_email, resend_id, ok, error_msg) VALUES ($1,$2,$3,$4,$5)`,
    [iccidRaw, to, resendId, ok, errorMsg]
  ).catch(() => {});

  if (!ok) return res.status(500).json({ error: errorMsg });
  res.json({ ok: true, id: resendId });
});

app.listen(PORT, () => console.log(`eSIMS server listening on :${PORT}`));
