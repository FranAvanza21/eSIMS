Conecta un método del dataProvider de `esims.html` con un endpoint real de la API SIA, reemplazando el mock actual.

Uso: /sia-connect [método] [endpoint]
Ejemplo: /sia-connect getAll GET /esims

El agente `sia-integration` hace lo siguiente:
1. Lee el método mock actual en `esims.html` (sección dataProvider, ~líneas 650-693)
2. Consulta el Swagger de SIA si está disponible para validar el contrato del endpoint
3. Implementa la llamada real con: fetch(), headers Authorization Bearer, manejo de errores (401/404/422/500)
4. Mapea la respuesta de SIA al modelo interno si hay diferencias de nombres de campo
5. Mantiene el mock comentado como fallback de desarrollo

Antes de modificar: muestra el plan de implementación y espera confirmación.
