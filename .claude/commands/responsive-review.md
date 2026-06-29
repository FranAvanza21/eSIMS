Ejecuta una revisión completa de calidad responsive de `esims.html` usando el subagente `qa-responsive`.

Revisa todos los componentes contra la checklist del agente:
- Navbar, chips de estadísticas, toolbar (búsqueda + filtros + botones)
- Tabla principal (especialmente columnas PIN/PUK/Acciones en móvil)
- Paginación
- Modal Alta/Edición (muchos campos, riesgo en pantallas pequeñas)
- Modal Importar con sus 3 tabs y la tabla de preview
- Toasts

Breakpoints a validar: 320px, 375px, 768px, 1024px, 1440px.

Entrega la lista de problemas encontrados con: componente afectado, breakpoint donde ocurre, descripción del problema, línea en esims.html y fix propuesto (clase Bootstrap o CSS).

Prioriza por impacto: primero los problemas que hacen unusable la app, luego los cosméticos.
