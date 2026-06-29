// config.example.js — Plantilla de configuración
// Copia este fichero como "config.js", rellena los valores reales
// y NUNCA subas config.js al repositorio (está en .gitignore).

window.APP_CONFIG = {
  // URL base de la API de SIA
  SIA_BASE: 'https://sia.avanzasolutions.es/api',

  // Token para pruebas locales sin plataforma OyM
  // En producción OyM inyecta el token en sessionStorage directamente
  // AUTH_TOKEN: 'token-de-prueba-aqui',
};
