const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const https    = require('https');
const { Resend } = require('resend');

const app    = express();
const resend = new Resend(process.env.RESEND_API_KEY);
const PORT   = process.env.PORT || 3000;

const LOGO_URL = 'https://static.avanzafibra.net/png/logo_400px.png';
let   logoBase64 = null;

function fetchLogo() {
  return new Promise((resolve) => {
    https.get(LOGO_URL, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        logoBase64 = Buffer.concat(chunks).toString('base64');
        resolve();
      });
    }).on('error', () => resolve()); // fallo silencioso — el logo simplemente no aparece
  });
}
fetchLogo();

// Security headers (mirrors previous nginx.conf)
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

// Block dotfiles
app.use((req, res, next) => {
  if (/\/\./.test(req.path)) return res.status(404).end();
  next();
});

app.use(express.json({ limit: '5mb' }));
app.use(express.static(__dirname, { index: 'esims.html' }));

// POST /api/send-email
// Body: { to: string, iccid: string, qrBase64: string }
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
    const logoSrc = logoBase64
      ? `data:image/png;base64,${logoBase64}`
      : LOGO_URL;
    htmlBody = tpl
      .replace(/\{\{NOMBRE\}\}/g,   nombre || 'Cliente')
      .replace(/\{\{ICCID\}\}/g,    iccid)
      .replace(/\{\{QR_IMAGE\}\}/g, qrImg)
      .replace(LOGO_URL, logoSrc);
  } catch {
    return res.status(500).json({ error: 'No se pudo cargar la plantilla de correo.' });
  }

  try {
    const { data, error } = await resend.emails.send({
      from:    'AVANZA FIBRA <noreply@avanzasolutions.es>',
      to:      [to],
      subject: `Tu eSIM AVANZA FIBRA está lista — Nº ${iccid}`,
      html:    htmlBody,
    });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, id: data.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`eSIMS server listening on :${PORT}`));
