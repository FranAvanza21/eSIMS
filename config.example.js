// config.example.js — Plantilla de configuración
// Copia este fichero como "config.js", rellena los valores reales
// y NUNCA subas config.js al repositorio (está en .gitignore).

const CONFIG = {
  // URL base de la API de SIA
  // TODO: confirmar el endpoint real de eSIMs con el equipo de SIA
  SIA_BASE: 'https://sia.avanzasolutions.es/api',

  // Credenciales para autologin (si no se usa OyM)
  // TODO: valorar si la autenticación la gestiona OyM directamente
  SIA_USER: 'USUARIO_AQUI',
  SIA_PASS: 'CONTRASEÑA_AQUI',
};
