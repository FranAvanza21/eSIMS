# DESIGN-NOTES — Sistema de Diseño Avanza Solutions

> Documento de referencia generado por análisis de las apps existentes.
> Usar como guía para mantener coherencia visual y arquitectónica entre todas las apps del ecosistema.

---

## 1. Apps existentes analizadas

| App | Ruta | Stack | Complejidad |
|-----|------|-------|-------------|
| Revisador de Cobertura | `Revisador cobertura/cobertura.html` | HTML+CSS+JS single-file + Bootstrap 5.3 | Media-alta |
| Suscripciones de Cobertura | `Suscripciones cobertura/index.html` | HTML+CSS+JS single-file + Bootstrap 5.3 | Baja |
| Control de Flota | `track flota/client/` | React 18 + TypeScript + Vite + Vanilla CSS | Alta |
| Gastos Pro | `Tickelia Avanza/gastos-pro/` | React 19 + TypeScript + Vite + Tailwind 4 + Zustand | Alta |
| Avanza Facturas | `avanza-facturas/frontend/` | Next.js 14 + TypeScript + Tailwind 3 + Radix UI | Alta |

---

## 2. Paleta de colores

### Primarios (azul corporativo Avanza)
```
#0d6efd   — Bootstrap primary (apps HTML simples)
#2456b5   — blue-main (Track Flota, referencia corporate)
#3569c0   — blue-600 (Gastos Pro, apps React modernas)
#1a3a8f   — blue-mid (sombras y nav dark)
#0d1f4e   — blue-dark (sidebar / fondos profundos)
```

### Escala azul completa (Gastos Pro — más detallada)
```
#eef4fc   — blue-50   (fondos muy claros, hover states)
#d5e5f8   — blue-100
#aacaf0   — blue-200
#74a7e4   — blue-300
#4a84d6   — blue-400
#3569c0   — blue-500 (primario principal)
#2554a0   — blue-600
#1b3f80   — blue-700
#1a3468   — blue-800
#102050   — blue-900
#080f28   — blue-950  (sidebar / headers dark)
```

### Semánticos
```
#22c55e   — verde (éxito, activo, online)
#ef4444   — rojo (error, inactivo, eliminado)
#f59e0b   — ámbar (advertencia, pendiente)
#6c757d   — gris (secundario, texto muted)
#f8f9fa   — gris muy claro (fondo de página — bg-light)
#ffffff   — blanco (cards, fondos de contenido)
```

---

## 3. Tipografía

**Fuente recomendada** (consistente en apps modernas):
```css
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
```

**Escala de tamaños** (referencia Track Flota — la más detallada):
```
0.68rem  — etiquetas muy pequeñas, badges internos
0.72rem  — field-label uppercase (usado en Suscripciones)
0.75rem  — xs (texto auxiliar, timestamps)
0.875rem — sm (texto secundario, descripciones)
1rem     — base (texto normal)
1.125rem — md+ (subtítulos)
1.25rem  — xl (títulos de sección)
1.5rem   — 2xl (títulos de card)
```

**Pesos:**
```
400 — texto normal
500 — etiquetas, navegación
600 — botones, emphasis
700 — títulos
800 — títulos principales / emphasis fuerte
```

---

## 4. Componentes de UI y sus estilos

### 4.1 Cards
```css
/* Bootstrap (apps HTML) */
.card { border: 1px solid rgba(0,0,0,.125); border-radius: 0.375rem; }
.card.shadow-sm { box-shadow: 0 .125rem .25rem rgba(0,0,0,.075); }
.card-header { padding: 0.75rem 1rem; background: #f8f9fa; border-bottom: 1px solid rgba(0,0,0,.125); }

/* Moderno (React apps) */
border: 1px solid #e2e8f0; border-radius: 0.75rem; box-shadow: 0 1px 3px rgba(0,0,0,.1);
```

### 4.2 Botones
```css
/* Primario */
background: #2456b5; /* o gradient azul oscuro */
color: white; border: none; border-radius: 0.375rem;
padding: 0.5rem 1rem; font-weight: 600; cursor: pointer;

/* Secundario / outline */
background: transparent; border: 1px solid #2456b5;
color: #2456b5;

/* Peligro */
background: #ef4444; color: white;

/* Pequeño */
padding: 0.25rem 0.5rem; font-size: 0.875rem;
```

### 4.3 Tablas
```css
/* Bootstrap: .table .table-sm .table-bordered .table-hover */
border-collapse: collapse; width: 100%;
thead: background azul, texto blanco, font-weight 600
tbody: filas alternadas (striped) o hover
```

### 4.4 Formularios
```css
/* Inputs */
.form-control: border: 1px solid #ced4da; border-radius: 0.375rem; padding: 0.375rem 0.75rem;
focus: border-color #0d6efd, box-shadow 0 0 0 0.25rem rgba(13,110,253,.25);
error: border-color #ef4444, fondo rojo muy claro

/* Labels */
font-weight: 500; font-size: 0.875rem; margin-bottom: 0.25rem;
```

### 4.5 Badges / Estados
```css
/* Estado activo/éxito */
background: #dcfce7; color: #166534; border-radius: 9999px; padding: 0.125rem 0.625rem;

/* Estado inactivo/error */
background: #fee2e2; color: #991b1b;

/* Estado pendiente/advertencia */
background: #fef3c7; color: #92400e;

/* Estado neutro/gris */
background: #f1f5f9; color: #475569;
```

### 4.6 Paneles expandibles
Patrón de `cobertura.html`:
```css
.result-expandable { max-height: 0; overflow: hidden; transition: max-height 0.3s ease; }
.result-expandable.expanded { max-height: 4000px; }
```

### 4.7 Autocomplete custom
Patrón de `cobertura.html`:
```css
.ac-wrapper { position: relative; }
.ac-dropdown { position: absolute; top: 100%; left: 0; right: 0; z-index: 100;
  background: white; border: 1px solid #ced4da; border-radius: 0.375rem;
  max-height: 220px; overflow-y: auto; box-shadow: 0 4px 12px rgba(0,0,0,.15); }
.ac-item { padding: 0.5rem 0.75rem; cursor: pointer; }
.ac-item:hover { background: #e9ecef; }
```

### 4.8 Empty state
Patrón de `suscripciones/index.html`:
```css
.empty-state { text-align: center; padding: 3rem 1rem; color: #6c757d; }
```

---

## 5. Patrones de Layout

### Página completa (apps HTML simples)
```html
<body class="bg-light">
  <nav class="navbar navbar-dark bg-primary">  <!-- azul principal -->
  <div class="container-fluid py-3">
    <div class="row">
      <div class="col-lg-6">  <!-- Panel izquierdo / formulario -->
      <div class="col-lg-6">  <!-- Panel derecho / resultados -->
```

### Panel compacto (Suscripciones)
```html
<div class="container py-4" style="max-width: 900px;">
  <div class="card shadow-sm">
    <div class="card-header d-flex align-items-center justify-content-between">
    <div class="card-body p-0">
```

---

## 6. Autenticación

### Patrón común (apps HTML):
```javascript
// En sessionStorage: 'authToken'
// En config.js: SIA_USER, SIA_PASS (NO en el código fuente)
// Login automático al cargar la página:
async function login() {
  const res = await fetch(`${SIA_BASE}/Account/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: SIA_USER, password: SIA_PASS })
  });
  const data = await res.json();
  sessionStorage.setItem('authToken', data.token);
}

// En cada llamada:
headers: { 'Authorization': `Bearer ${sessionStorage.getItem('authToken')}` }
```

### Punto de integración futuro (OyM):
```javascript
// TODO: integrar con plataforma OyM / auth externa
// Por ahora: autologin con config.js (nunca hardcodear credenciales)
```

---

## 7. Comunicación con la API (SIA)

### Base URL
```javascript
// En config.js (NO en el código fuente):
// const SIA_BASE = 'https://sia.avanzasolutions.es/api';

// Helper de fetch:
async function apiFetch(endpoint, options = {}) {
  const token = sessionStorage.getItem('authToken');
  const res = await fetch(`${SIA_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`);
  return res.json();
}
```

### Patrón de manejo de errores
```javascript
try {
  mostrarCargando(true);
  const datos = await apiFetch('/endpoint');
  renderizarDatos(datos);
} catch (err) {
  mostrarError('No se pudieron cargar los datos. Inténtalo de nuevo.');
  console.error('Error en /endpoint:', err);
} finally {
  mostrarCargando(false);
}
```

---

## 8. Convenciones de código

- **Idioma de la UI:** Español (labels, placeholders, mensajes de error, confirmaciones)
- **Idioma del código:** Español para comentarios clave; inglés para nombres de variables/funciones (camelCase)
- **Comentarios:** Solo cuando el "por qué" no es obvio
- **Funciones:** Cortas, una sola responsabilidad, nombres descriptivos en inglés
- **Separación clara:** UI / Lógica de negocio / Acceso a datos
- **DOM:** Nunca `innerHTML` con datos sin escapar (prevención XSS)
- **Secretos:** Nunca en el código fuente; siempre en `config.js` no versionado

---

## 9. Stack recomendado según complejidad del proyecto

| Complejidad | Stack recomendado |
|-------------|-------------------|
| Baja (consulta, 1-2 pantallas) | HTML + Bootstrap 5.3 single-file |
| Media (CRUD, filtros, listados) | HTML + Bootstrap 5.3 single-file, o React + Vite |
| Alta (tiempo real, multi-usuario, gráficos complejos) | React/Next.js + TypeScript + Tailwind |

---

## 10. Checklist de calidad para toda app nueva

- [ ] UI completamente en español
- [ ] Colores de la paleta Avanza (azul #2456b5 / #3569c0)
- [ ] Estados de carga, vacío y error implementados
- [ ] Ningún `innerHTML` con datos sin escapar
- [ ] Secretos en `config.js` (no versionado), nunca en el código
- [ ] Token de autenticación en `sessionStorage`, nunca en `localStorage` ni en el código
- [ ] Capa de datos aislada (`dataProvider` o similar) para facilitar integración con API real
- [ ] Validación de entradas en formularios
- [ ] Manejo de errores con mensajes en español
- [ ] Código organizado: UI / Lógica / Datos bien separados
