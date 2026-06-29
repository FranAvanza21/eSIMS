Ejecuta una auditoría de seguridad completa del proyecto eSIMS usando el subagente `security-auditor`. 

Revisa estos 6 vectores en `esims.html`, `Dockerfile`, `config.example.js`:
1. Gestión de secretos (hardcoded URLs, claves, CONFIG expuesto)
2. Autenticación y sesión (flujo login, tokens, rutas protegidas)
3. Validación de entrada (formularios, parsing CSV)
4. XSS / escapado del DOM (uso de esc(), innerHTML, preview importación)
5. Dependencias CDN (Bootstrap, Bootstrap Icons — versiones, CVEs conocidos)
6. Superficie expuesta (ficheros servidos, headers nginx, CORS)

Entrega un informe en `SECURITY-AUDIT-{fecha}.md` en la raíz del proyecto. Cada hallazgo con: severidad (🔴/🟠/🟡), ubicación exacta (archivo:línea), impacto y remediación propuesta.

**NO apliques correcciones automáticamente.** Primero el informe, luego espera orden para corregir.
