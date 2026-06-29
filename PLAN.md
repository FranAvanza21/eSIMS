# PLAN.md — eSIMS AVANZA FIBRA

> Generado en Fase 0 (exploración sin modificar código). Espera aprobación explícita antes de ejecutar cualquier cambio.
> Fecha: 2026-06-29

---

## 1. Resumen ejecutivo

El proyecto **no es un export de Lovable**. Es una **Single-File Application (SFA)** en HTML5 + CSS inline + JavaScript vanilla, con Bootstrap 5.3 como único framework. No hay npm, no hay bundler, no hay TypeScript, no hay Supabase. Esto es una fortaleza (sin dependencias que auditar) y una limitación (no se puede aplicar el toolkit de Lovable tal cual).

El MVP está funcionalmente completo para gestión CRUD + importación masiva, con datos mock y preparado para conectar a la API SIA. El estado de producción es **pre-auth**: la autenticación está pendiente de implementar.

---

## 2. Arquitectura real

```
eSIMS/
├── esims.html          ← Toda la app: HTML + CSS (<style>) + JS (<script>)  [1.478 líneas]
├── config.example.js   ← Plantilla de credenciales (NO contiene secretos reales)
├── Dockerfile          ← nginx:alpine, copia esims.html + config.example.js
├── .gitignore          ← Excluye config.js (el real, nunca committeado)
└── DESIGN-NOTES.md     ← Guía de diseño corporativo Avanza Solutions
```

### Flujo de datos

```
Usuario (browser)
    │
    ▼
nginx:alpine (Docker · esims.avzdev.com)
    │
    ├── GET / → esims.html (toda la app)
    └── [Futuro] fetch() → SIA API (sia.avanzasolutions.es/api)

Estado actual: datos mock en memoria (array MOCK_ESIMS)
```

### Módulos internos de `esims.html`

| Módulo | Líneas aprox. | Responsabilidad |
|--------|---------------|-----------------|
| CSS (variables + componentes) | 1–154 | Identidad Avanza, badges de estado, layout |
| HTML (navbar + stats + tabla + modales) | 164–590 | Estructura y plantillas |
| CONFIG | 593–599 | URL base SIA (hardcoded) |
| PLANES / ESTADOS / MOCK_ESIMS | 601–649 | Constantes + datos de prueba |
| dataProvider | 650–693 | Capa de datos (mock → API SIA) |
| Utilidades | 696–726 | `esc()`, `formatIccid()`, `validarEmail()`, etc. |
| `app` IIFE | 730–1473 | Estado, render, modales, importación, UX |

---

## 3. Inventario de pantallas y estado de calidad

| Pantalla / Componente | Estado funcional | Diseño desktop | Responsive móvil | Accesibilidad |
|----------------------|-----------------|----------------|-----------------|---------------|
| Navbar | ✅ Completo | ✅ Bueno | ✅ Colapsa bien | ⚠️ Sin skip-to-content |
| Chips de estadísticas | ✅ Completo | ✅ Bueno | ⚠️ Sin verificar overflow en 320px | — |
| Toolbar (búsqueda + filtros) | ✅ Completo | ✅ Bueno | ⚠️ Botones podrían apilarse mal | — |
| Tabla principal | ✅ Completo | ✅ Bueno | ⚠️ Riesgo de scroll horizontal en cols PIN/PUK/Acciones | ⚠️ Sin aria-labels en botones de acción |
| Paginación | ✅ Completo | ✅ OK | ⚠️ Sin verificar en pantallas pequeñas | — |
| Modal Alta/Edición | ✅ Completo | ✅ Bueno | ⚠️ Sin verificar en móvil (muchos campos) | ⚠️ Falta `aria-describedby` |
| Modal Cambio Estado | ✅ Completo | ✅ Bueno | ✅ Simple, debería estar OK | — |
| Modal Eliminar | ✅ Completo | ✅ Bueno | ✅ Simple, debería estar OK | — |
| Modal Importar (3 tabs) | ✅ Completo | ✅ Bueno | ⚠️ Drop zone + tabla preview en móvil: riesgo | — |
| Toasts | ✅ Completo | ✅ Bueno | ✅ Bootstrap los gestiona bien | — |

**Leyenda:** ✅ Verificado OK · ⚠️ Riesgo identificado, no verificado en detalle · ❌ Problema confirmado

---

## 4. Stack y dependencias detectadas

| Capa | Tecnología | Versión | Cómo se consume |
|------|-----------|---------|----------------|
| CSS framework | Bootstrap | 5.3.0 | CDN (jsDelivr) |
| Iconos | Bootstrap Icons | 1.11.1 | CDN (jsDelivr) |
| JS framework | Vanilla JS | ES2020+ | Inline en HTML |
| Servidor web | nginx | alpine (latest) | Docker |
| Despliegue | Coolify | — | self-hosted en 82.223.24.115 |
| DNS | Cloudflare | — | DNS only (sin proxy) |

**Sin dependencias npm.** No hay lockfile que auditar. Las dependencias de CDN no se auditan con `npm audit`; habría que verificar contra bases de vulnerabilidades manualmente o sustituir por copias locales.

---

## 5. Riesgos de seguridad (primera vista)

> Severidades: 🔴 Alta · 🟠 Media · 🟡 Baja · 🟢 OK

| # | Riesgo | Severidad | Ubicación |
|---|--------|-----------|-----------|
| S1 | `CONFIG.SIA_BASE` hardcodeado en el HTML. No es una credencial, pero si el URL del API cambia habría que redesplegar | 🟡 Baja | `esims.html:594` |
| S2 | `config.example.js` se copia al webroot en el Dockerfile → cualquiera puede hacer `GET /config.example.js`. Solo contiene placeholders, pero revela el esquema de credenciales | 🟡 Baja | `Dockerfile:3` |
| S3 | **Sin autenticación implementada.** La app es accesible sin login. El gancho OyM está marcado como TODO. En producción con Coolify, la app está en internet abierta. | 🔴 Alta | `esims.html` — `app.init()` |
| S4 | `esc()` protege contra XSS en renderizado de tabla — correcto. Pero el modal de importación renderiza una tabla de preview: verificar que todos los campos de usuario también pasen por `esc()` | 🟠 Media | `_renderPreviewImport()` |
| S5 | Dependencias vía CDN: si jsDelivr fuera comprometido, la app ejecutaría código arbitrario. Relevante para app interna con datos sensibles (PIN, PUK) | 🟠 Media | `esims.html:4-8` |
| S6 | PIN y PUK se almacenan como texto plano en el array de eSIMs del cliente. Correctamente enmascarados en UI, pero están en memoria del navegador | 🟡 Baja | `dataProvider`, `app.state.esims` |

**La auditoría completa** (S1–S7 del prompt maestro) la ejecutará el subagente `security-auditor` cuando lo indiques.

---

## 6. Subagentes propuestos

A crear en `.claude/agents/` una vez aprobado este plan. **Adaptados al stack real** (HTML+Bootstrap, no React+Supabase).

### `frontend-design`
```
Rol: Experto en diseño UI/UX con Bootstrap 5 y CSS vanilla.
Scope: coherencia visual, sistema de diseño (tokens CSS, spacing, tipografía),
       comportamiento responsive en todos los breakpoints, calidad pixel.
Herramientas mínimas: Read, Edit (solo esims.html y DESIGN-NOTES.md)
Cuándo invocar: cambios visuales, nuevas pantallas, revisión responsive.
```

### `security-auditor`
```
Rol: Auditor de seguridad. Solo reporta, no corrige sin orden explícita.
Scope: secretos, auth, XSS, dependencias, superficie expuesta.
Herramientas mínimas: Read, Grep, Bash (solo npm audit y grep)
Cuándo invocar: al escribir "auditoría de seguridad" o /audit.
```

### `qa-responsive`
```
Rol: Guardián de calidad responsive. Valida cada cambio UI antes de darlo por terminado.
Scope: checklist de responsive (overflow, texto cortado, áreas táctiles, breakpoints).
Herramientas mínimas: Read (solo esims.html)
Cuándo invocar: después de cualquier cambio de UI, antes de commit.
```

### `sia-integration`
```
Rol: Experto en integración con la API SIA de Avanza Solutions.
Scope: dataProvider (mock → real), manejo de errores de red, auth tokens.
Herramientas mínimas: Read, Edit, WebFetch (para Swagger de SIA)
Cuándo invocar: cuando empiece la integración real con sia.avanzasolutions.es.
```

> ⚠️ **Nota técnica:** Los subagentes de Claude Code van en `.claude/agents/`. Los slash commands reutilizables van en `.claude/commands/` (no `.claude/skills/` como menciona el prompt maestro — esa ruta no es la convención real de Claude Code).

---

## 7. Skills (slash commands) propuestas

A crear en `.claude/commands/` cuando aparezca el patrón repetido suficientes veces.

| Skill | Cuándo crear | Descripción |
|-------|-------------|-------------|
| `/responsive-review` | Tras el primer rediseño completo | Checklist Bootstrap responsive para este proyecto |
| `/audit` | Ahora (lo menciona el prompt maestro explícitamente) | Dispara al subagente `security-auditor` |
| `/sia-connect` | Cuando empiece integración API | Template para añadir un endpoint SIA al dataProvider |

---

## 8. Hoja de ruta sugerida

### Fase 1 — Auditoría y base sólida (sin nuevas features)
1. Crear subagentes y skill `/audit`
2. Ejecutar auditoría de seguridad completa
3. Revisar responsive en puntos críticos (tabla en móvil, modal importación)
4. Mover `CONFIG.SIA_BASE` a `config.js` (fuera del HTML)

### Fase 2 — Autenticación
5. Integrar autenticación OyM (Bearer token) en el gancho de `app.init()`
6. Proteger rutas (redirect a login si no hay token)
7. Mostrar usuario en navbar

### Fase 3 — Integración API SIA
8. Sustituir `dataProvider` mock por llamadas reales
9. Autocomplete de `id_cliente` contra API SIA

### Fase 4 — Pulido UX/UI
10. Revisión responsive completa con `qa-responsive`
11. Mejoras de accesibilidad (aria-labels, foco visible)
12. Posibles mejoras de diseño según DESIGN-NOTES.md

---

## 9. Preguntas pendientes

Antes de avanzar en la hoja de ruta necesito respuesta a:

1. **Prioridad:** ¿Por dónde quieres empezar? ¿Autenticación OyM, auditoría de seguridad, responsive, o integración API SIA?
2. **Auth OyM:** ¿Tienes documentación del endpoint de autenticación OyM? ¿Devuelve un Bearer token estándar o tiene algún esquema propio?
3. **API SIA:** ¿Está disponible el Swagger de `sia.avanzasolutions.es`? ¿El endpoint de eSIMs ya existe o está en desarrollo?
4. **CDN vs local:** ¿Quieres mover Bootstrap y Bootstrap Icons a ficheros locales (para eliminar dependencia de CDN y el riesgo S5)?

---

> **Estado:** Esperando confirmación. No se ha modificado ningún fichero del proyecto.
