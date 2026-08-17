# PLAN-AUTHENTIK.md — Authentik como segunda vía de acceso

> **Estado: implementado y verificado en local. Sin desplegar.** Ver §15 y §16.
> v1: 2026-08-16 (diseño) · v2: 2026-08-16 · v3: 2026-08-17 · **v4: 2026-08-17**
> Fichero aparte de `PLAN.md` (que es de 2026-06-29 y cubre otra fase; no se ha tocado).

**Cambios de v1 → v2:** dominio de Authentik corregido · §1ter nueva (Authentik verificado)
· §3 razonamiento de `openid-client` corregido y decisión tomada · §5 **invalidado y
reescrito** por `email_verified:false` · §7 reescrito (redirect URI de variable, sin
cabeceras) · §9bis nueva (trampas heredadas) · B2 y B4 resueltos.

**Cambios de v2 → v3:** B0 resuelto (**opción A**) · **B0b eliminado**: las filas
solo-Authentik llevan un hash bcrypt aleatorio, así que **no hay `ALTER COLUMN` ni se toca
`POST /api/login`** · B8 resuelto: **9 personas**, §1quater nueva y
`migracion-authentik.sql` generado · B9 nuevo (los correos de Authentik deben coincidir).

**Cambios de v3 → v4:** implementación hecha y verificada (§15) · 2 altas más
(`fvalera` y `jgalvez`, ambos `@avanzasolutions.es`) → **12 filas** · slug real de la
Application: **`gestion-esims`**, no `esims` · desviación anotada: páginas de error del
servidor en vez de `?auth_error=` · segunda Redirect URI (la raíz) para el logout.

---

## 0. Bloqueantes

| # | Bloqueante | Estado |
|---|-----------|--------|
| ~~B1~~ | ¿Los `username` son correos? | **RESUELTO.** No. Y hay una sola fila, `admin`. Ver §1bis |
| ~~B2~~ | URL de Authentik y su configuración | **RESUELTO.** `https://auth.avanzafibra.net`, verificado. Ver §1ter |
| ~~B4~~ | Texto literal del enlace de recuperación | **RESUELTO, y la respuesta es que no hay enlace.** Ver §1ter |
| ~~B5~~ | Qué hacer con el desconocido | **Absorbido por B0** |
| ~~B6~~ | Permiso e implementación de `openid-client` | **RESUELTO.** v6 vía `await import()`. Ver §3 |
| ~~B0~~ | Cómo aparecen las filas de las personas | **RESUELTO: opción A (pre-crear a mano), 2-5 personas.** Ver §1bis |
| ~~B0b~~ | ¿Guardia `if (!user.password_hash)` en el login local? | **ELIMINADO.** Ya no hace falta tocar el login local. Ver §1bis |
| ~~B8~~ | La lista de correos | **RESUELTO: 9 personas, todas `@avanzafibra.com`.** SQL generado en `migracion-authentik.sql`. Ver §1quater |
| **B9** | **¿El correo que Authentik tiene para cada persona es EXACTAMENTE el de la lista?** | **ABIERTO.** Si no coincide, esa persona no empareja. Ver §1quater |
| **B3** | **¿Llega de verdad el correo de recuperación?** Probar en incógnito | **ABIERTO. Bloquea SOLO el aviso, no el código.** Si no llega: PARAR |
| B7 | Fecha para `AVISO_AUTHENTIK_FECHA` | Abierto. No bloquea código, solo el encendido del aviso |

---

## 1. Estado verificado del código actual

Leído, no supuesto:

| Cosa | Dónde | Estado |
|------|-------|--------|
| Backend único | `server.js`, 294 líneas | Express 4 |
| Sesión | `server.js:107-118` | `express-session` + `connect-pg-simple`, `createTableIfMissing` |
| Cookie | `server.js:112-117` | `httpOnly`, `secure` en prod, **`sameSite:'strict'`**, `maxAge` 8 h |
| `trust proxy` | `server.js:105` | `1` — ya puesto |
| Login local | `server.js:129-144` | bcrypt contra `users`, rellena `req.session.userId` y `.username` |
| Middleware protector | `server.js:151-156` | públicas `['/login','/me']`, exige `req.session.userId` |
| Esquema `users` | `server.js:45-50` | `id`, `username UNIQUE`, `password_hash NOT NULL`, `created_at`. **Sin `email`** |
| Creación de usuarios | `server.js:54-64` | Solo `bootstrapAdmin()` desde `ADMIN_USER`. **No hay endpoint de alta** |
| Creación de tablas | `server.js:22-52` | `initDB()`: un único bloque `CREATE TABLE IF NOT EXISTS` al arrancar |
| Overlay de login | `esims.html:188-212` | `label` "Usuario", `input type="text"` |
| **CSS del overlay** | `esims.html:164-176` | **`position:fixed; inset:0; display:flex; align-items:center` SIN `overflow`. Ver §9bis — es la trampa de track-flota, y está aquí** |
| `init()` / `handleLogin()` / `logout()` | `esims.html:895-948` | `logout()` hace `fetch` + `location.reload()` |
| CSP | `server.js:88-96` | `default-src 'none'`. **No bloquea navegaciones top-level**: el botón OIDC no necesita cambios de CSP |
| `nginx.conf` | Todo el fichero | **Muerto.** Sin `proxy_pass`, sin `X-Forwarded-*`, y el Dockerfile no lo copia |
| Deploy real | `Dockerfile` | `node server.js` en :80. El proxy es el Traefik de Coolify |

**`AUTH_TOKEN` de `config.example.js` es de la API de SIA. No se toca, no aparece en este plan.**

---

## 1bis. La tabla `users` — RESUELTO, y condiciona todo

Consultado en producción el 2026-08-16:

```json
[{ "id": 1, "username": "admin", "parece_correo": false,
   "created_at": "2026-07-03 10:23:40.481497+00" }]
```

**No son correos, y hay una única fila.** Su `created_at` coincide con el despliegue del commit `bcd506a` ("sistema de autenticación"): es la fila del bootstrap desde `ADMIN_USER`.

**No existen "los usuarios" de esta aplicación. Existe una cuenta compartida.** No hay nada a lo que enganchar identidades de Authentik.

### La cadena que acaba mal si no se ve a tiempo

1. El punto 5 del encargo dice que quien no exista aquí no entra.
2. Aquí solo existe `admin`, que no es una persona y no tiene correo.
3. → El botón de Authentik respondería "no estás dado de alta" al **100%** de la gente.
4. El aviso dice *"entrad YA con el botón nuevo para comprobar que os funciona"*.
5. → Publicar el aviso antes de que existan las filas manda a toda la plantilla a un botón que falla siempre, y por indicación expresa.

### Decisión tomada (B0) — 2026-08-17

**Opción A: pre-crear una fila por persona.** Estimadas 2-5; resultaron ser **11**.

Respeta el punto 5 del encargo: el control de acceso queda **doble** — binding de grupo en Authentik **y** fila en esta tabla. Con este tamaño de equipo el coste es un puñado de `INSERT` una sola vez, y el mantenimiento posterior (un alta cuando entre alguien nuevo) es prácticamente nulo.

Descartada la opción B (auto-provisionar), que habría invertido el punto 5 dejando el control solo en Authentik.

**Pendiente: la lista de correos (B8).**

### No hace falta columna `email`

Las filas se crean con **`username = 'persona@avanzasolutions.es'`**, y el emparejamiento por correo funciona contra `username` tal cual, sin esquema nuevo. La fila `admin` nunca empareja con nadie, que es lo correcto.

### `password_hash NOT NULL` — resuelto SIN tocar el login local

La v2 de este plan proponía `DROP NOT NULL` + un guardia `if (!user.password_hash) return 401` en `POST /api/login`. **Ya no hace falta ninguna de las dos cosas**, y por tanto el login local se queda intacto, como pediste.

En su lugar, cada fila nueva se crea con un **hash bcrypt de 64 bytes aleatorios que nadie conoce ni conocerá**. Es un hash perfectamente válido, así que `bcrypt.compare` se comporta con normalidad y **siempre devuelve `false`**.

Comprobado en este proyecto el 2026-08-17 con la `bcryptjs` que ya está instalada:

```
hash generado : $2b$10$8YjKMT3Xlqn48OgFMUHfF.uCtxa/MuEZPQqLa4rGcB4cPDxN.n5wC   (60 chars)
compare("")          -> false
compare("admin")     -> false
compare("1234")      -> false
compare("password")  -> false
compare(<20 chars del secreto>) -> false
```

Ventajas sobre la propuesta anterior:

| | Con `NULL` + guardia | Con hash aleatorio |
|---|---|---|
| `ALTER TABLE` | Sí | **No** |
| Tocar `POST /api/login` | Sí | **No** |
| Riesgo sobre el acceso actual | Bajo, pero no nulo | **Nulo: no se cambia una línea** |
| Garantía de que no se entra | Estructural (`if`) | Criptográfica (64 bytes aleatorios) |

> **Por qué es seguro:** no es "seguridad por valor desconocido" en el sentido malo. El
> secreto se genera con `crypto.randomBytes(64)`, se hashea y **se descarta sin guardarse
> en ningún sitio**. Encontrar una contraseña que case es exactamente igual de inviable
> que romper la contraseña de cualquier otra cuenta.

> **Nota de mantenimiento:** una fila así es indistinguible de una cuenta normal mirando
> la tabla. Queda documentado aquí y en el comentario del SQL de altas: **las filas con
> correo por `username` son solo-Authentik y su `password_hash` es basura deliberada.**
> Si algún día quieres darle contraseña local a alguna, es un `UPDATE` normal.

Los hashes están generados y verificados uno a uno: ver §1quater.

---

## 1quater. Las altas — generadas (nuevo en v3)

Recibida la lista el 2026-08-17. **Son 9 personas, no 2-5**, todas con correo `@avanzafibra.com`:

```
alinares · lgarcia · mriquelme · ahadini · chuertas
mleal · mbarquero · jrequiel · iperez          (todas @avanzafibra.com)
```

Nueve no cambia la decisión —la opción A sigue siendo la buena— pero sí conviene anotarlo, porque parte de la recomendación se apoyaba en el tamaño del equipo. Con 9 el alta inicial sigue siendo trivial y el mantenimiento posterior es un `INSERT` por cada incorporación.

**SQL generado en `migracion-authentik.sql`** (fichero aparte, en la raíz del proyecto). Contiene el `ALTER TABLE`, los 9 `INSERT` y tres consultas de comprobación. **Lo ejecutas tú.**

Cada hash se generó con `crypto.randomBytes(64)` → `bcrypt.hash(…, 10)` → el secreto se descarta. El generador comprueba para cada fila, antes de escribirla, que:
- el hash tiene 60 caracteres y empieza por `$2`;
- `compare` devuelve `false` contra `""`, `admin`, `1234`, `password`, el propio correo y un fragmento del secreto;
- no hay dos hashes iguales entre las 9 filas (consulta (c) del fichero).

> **Higiene:** `migracion-authentik.sql` contiene hashes de contraseña. Es de un solo uso.
> Bórralo tras aplicarlo o añádelo a `.gitignore` — no hace falta que viva en el repo.
> No lo he añadido yo para no tocar `.gitignore` sin pedirlo; dímelo y lo hago.

### B9 — el emparejamiento depende de que los correos coincidan EXACTAMENTE

El paso (b) del §5 compara `lower(claims.email)` con `lower(username)`. Si Authentik tiene para alguien un correo distinto del de esta lista —`@avanzasolutions.es` en vez de `@avanzafibra.com`, un alias, un punto de más—, **esa persona no empareja y se queda fuera** el día del corte.

**Hay que verificarlo persona por persona en Authentik antes de encender el aviso.** Es una comprobación de 5 minutos que evita el escenario de "a tres no les funciona y no sabemos por qué". Se recoge como punto 22 del §12.

### Altas añadidas el 2026-08-17

| Fichero | Persona | Estado |
|---|---|---|
| `migracion-authentik.sql` | Las 9 `@avanzafibra.com` | **Aplicado y verificado** |
| `migracion-authentik-2.sql` | `fvalera@avanzasolutions.es` | Generado |
| `migracion-authentik-3.sql` | `jgalvez@avanzasolutions.es` | Generado |

Mismo procedimiento en los tres: hash bcrypt de 64 bytes aleatorios descartados,
verificado uno a uno, `ON CONFLICT DO NOTHING`. Total esperado: **12 filas** = `admin`
+ 11 personas. `.gitignore` excluye el patrón `migracion-authentik*.sql`.

### Efecto en el texto del aviso — resuelto

La duda de si nombrar los dos dominios queda zanjada: **9 personas `@avanzafibra.com` y
2 `@avanzasolutions.es`**. Los dos dominios se quedan en el aviso, que es lo que pedía el
encargo, y ahora los dos aplican a alguien de verdad.

### Nota sobre el §5

`fvalera` y `jgalvez` son **los dos administradores que pueden cambiar correos en
Authentik**, es decir, exactamente las dos personas de las que depende que
`OIDC_VINCULAR_SIN_EMAIL_VERIFICADO=true` sea seguro. Ahora además tienen fila propia en
`users`. No cambia el diseño, pero conviene tenerlo presente al releer el §5: si algún
día se amplía quién puede editar correos en Authentik, esta variable hay que revisarla.

### La cuenta `admin` es la red de seguridad

**No debe depender de Authentik para nada.** Conserva su `password_hash`, sigue entrando por el login local, y si Authentik se cae o se configura mal, sigue habiendo forma de entrar. No se le pone `oidc_sub`, no se toca su fila.

---

## 1ter. Authentik — lo verificado (nuevo en v2)

Instancia: **`https://auth.avanzafibra.net`**
*(la v1 de este plan decía `auth.avanzasolutions.es`. Era incorrecto.)*

### Comprobado sin credenciales el 2026-08-16

| Comprobación | URL | Resultado |
|---|---|---|
| ¿Existe ya la Application? | `/application/o/esims/…` y `/application/o/gestion-esims/…` | **HTTP 404 las dos** (comprobado 2026-08-16 y 2026-08-17). Hay que crearla |
| ¿Existe el flujo de recuperación? | `/api/v3/flows/executor/password-recovery/?query=` | **Sí.** `flow_designation:"recovery"`, `component:"ak-stage-identification"`, `user_fields:["email"]`, título "Recuperación de contraseña", botón "Continuar" |
| ¿La pantalla de login ofrece recuperación? | `/api/v3/flows/executor/default-authentication-flow/?query=` | Título "Inicio de sesión en Avanza Fibra". **NO hay `recovery_url` ni `enroll_url` en el challenge** |

### Consecuencia directa: B4 resuelto, y no como esperábamos

El flujo de recuperación **existe pero no está vinculado al Brand**, así que la pantalla de login de Authentik **no muestra ningún enlace de "he olvidado mi contraseña"**. Lo confirma la ausencia de `recovery_url` en el challenge del flujo de autenticación.

**No hay literal que copiar porque no hay enlace.** El aviso debe llevar **su propio enlace directo**:

```
https://auth.avanzafibra.net/if/flow/password-recovery/
```

Ventaja secundaria: así el texto del aviso **no depende de cómo se llame nada dentro de Authentik**, ni de que alguien cambie un rótulo el mes que viene.

> Alternativa que NO propongo: vincular el flujo al Brand para que salga el enlace. Es
> tocar Authentik para toda la organización desde una migración de esta app. Si lo
> quieres, es una casilla, pero es decisión tuya y no la doy por hecha.

### Lo que hay que crear en Authentik (aún no existe)

Application + OAuth2/OIDC Provider nuevos, slug **`gestion-esims`**
*(el plan proponía `esims`; el slug elegido el 2026-08-17 es `gestion-esims`. Solo afecta al valor de `OIDC_ISSUER` — no hay cambio de código, el issuer se lee de la variable de entorno):*

| Ajuste | Valor | Por qué importa |
|---|---|---|
| Client type | **Confidential** | Todo el intercambio en el servidor. El token nunca llega al navegador |
| **Signing Key** | **Puesta** | **Si falta, el `id_token` se firma en HS256 y el login falla.** Es el fallo silencioso más caro |
| PKCE | **S256** | Exigido por el diseño |
| Scopes | `openid`, `email`, `profile` | Sin `email` no hay emparejamiento posible |
| Include claims in id_token | **Activado** | Si no, los claims solo están en `/userinfo` y el flujo se complica |
| Subject mode | **Based on the User's hashed ID** | Confirmado: el `sub` llega como hash largo, **no** como correo. Es lo que lo hace inmutable |
| Redirect URI | La pública de producción, **absoluta y exacta** | Ver §7 |
| Redirect URI (2ª) | **También la raíz** `https://esims.avzdev.com/` | El logout manda `post_logout_redirect_uri` y Authentik rechaza las no registradas |
| Binding de grupo | El que corresponda | **Es el control de acceso real.** Aquí no habrá listas en el código |

Una vez creada, el discovery pasará a responder en
`https://auth.avanzafibra.net/application/o/gestion-esims/.well-known/openid-configuration`,
que es el valor de `OIDC_ISSUER` (sin el sufijo `.well-known/...`).

---

## 2. Regla de oro del diseño

El callback OIDC termina rellenando **la misma** sesión que el login local:

```js
req.session.userId   = user.id;
req.session.username = user.username;
```

**El middleware de `server.js:151-156` no se toca**, salvo añadir `/aviso` a la lista de públicas. Las rutas OIDC cuelgan de `/auth/*`, fuera de `/api`, así que ni las ve.

Si en algún momento me veo modificando la lógica de ese middleware, paro y lo digo.

---

## 3. `openid-client` — razonamiento corregido y decisión tomada (v2)

**Lo que decía la v1 y estaba mal encuadrado:** "la v6 es ESM puro, y `require(ESM)` exige Node ≥20.19, así que v5".

El dato es cierto pero **no aplica**: `require(ESM)` no es la única vía. Con **`await import()` dinámico la v6 funciona en Node 20 sin más**, y no hace falta convertir `server.js` a ESM. En `track-flota` corre la **6.8.5 en producción sobre `node:20-alpine`**.

**Decisión: v6 con `await import()`.** Motivos:

1. Es lo que ya está probado en producción en el proyecto hermano. Misma versión, mismo idioma, mismos errores conocidos. Divergir aquí sería crear dos formas distintas de hacer lo mismo en dos apps que mantiene la misma persona.
2. Es la línea mantenida.
3. El coste es cero: la carga ocurre dentro del bloque de arranque de OIDC, que **ya tiene que ser `async`** por el `discovery()`.

```js
// dentro del arranque async, solo si OIDC está configurado
const oidc = await import('openid-client');
```

La v5 sigue siendo una opción válida si prefieres CommonJS puro; solo hay que decirlo antes del paso 2, porque la API es distinta y el §8 está escrito para la v6.

---

## 4. Variables de entorno nuevas

| Variable | Obligatoria | Ejemplo | Para qué |
|----------|-------------|---------|----------|
| `OIDC_ISSUER` | Sí, si se activa OIDC | `https://auth.avanzafibra.net/application/o/gestion-esims/` | Discovery. **Con barra final y sin `.well-known/...`** |
| `OIDC_CLIENT_ID` | Sí, si se activa OIDC | `…` | Cliente confidencial |
| `OIDC_CLIENT_SECRET` | Sí, si se activa OIDC | `…` | Cliente confidencial |
| **`OIDC_REDIRECT_URI`** | **Sí, si se activa OIDC** | `https://esims.avzdev.com/auth/oidc/callback` | **Absoluta. Ver §7** |
| `OIDC_VINCULAR_SIN_EMAIL_VERIFICADO` | No (por defecto `false`) | `true` | **Ver §5. Sin esto no se vincula nadie** |
| `AVISO_AUTHENTIK_FECHA` | No | `1 de octubre de 2026` | Sin ella el aviso no se pinta |
| `AVISO_AUTHENTIK_RECOVERY_URL` | No | `https://auth.avanzafibra.net/if/flow/password-recovery/` | Por defecto ese mismo valor. Está como variable por si cambia el slug |

### El interruptor

- **Las cuatro `OIDC_*` obligatorias ausentes** → la app arranca **exactamente como hoy**: sin discovery, sin rutas `/auth/*`, y `/api/aviso` devuelve `oidcEnabled:false` → el botón no se pinta.
- **Alguna presente y otra no** → `process.exit(1)` al arrancar, nombrando la que falta:
  `Configuración OIDC incompleta: falta OIDC_REDIRECT_URI`.
- `AVISO_AUTHENTIK_FECHA` es **independiente**: puede haber aviso sin OIDC y al revés.
- `OIDC_VINCULAR_SIN_EMAIL_VERIFICADO` **no** cuenta para el interruptor: su ausencia es un valor válido (`false`), no una configuración a medias.

---

## 5. Vinculación de identidades — REESCRITO en v2

> **La v1 de esta sección era incorrecta y habría costado un despliegue.** Decía:
> *"solo se acepta `claims.email` si `claims.email_verified === true`"*.
> **Authentik envía `email_verified: false` para sus usuarios.** Con esa regla,
> **nadie se vincularía jamás** y el 100% de los intentos caería en la rama de
> "no estás dado de alta". Descubierto en `track-flota` a costa de un despliegue.

### El orden, que no cambia

```
a. SELECT * FROM users WHERE oidc_sub = claims.sub
   → hay fila: es esa persona. Fin. (sub es inmutable)

b. Solo si OIDC_VINCULAR_SIN_EMAIL_VERIFICADO === 'true':
   SELECT ... WHERE lower(username) = lower(claims.email) FOR UPDATE
   → hay fila: UPDATE users SET oidc_sub = :sub WHERE id = :id AND oidc_sub IS NULL
     (a partir de aquí nunca más se mira el correo para esta persona)

c. No hay fila → NO ENTRA (o se auto-provisiona, según B0)
```

**Por qué este orden y no al revés:** `email` y `preferred_username` son **mutables** desde Authentik. Quien pueda editar un perfil allí podría ponerse el correo de otra persona y apropiarse de su cuenta. `sub` es inmutable. Es el **hallazgo #21 de `avanza-facturas`**; no se repite.

### La variable, y de qué depende que sea segura

`OIDC_VINCULAR_SIN_EMAIL_VERIFICADO`, **por defecto `false`**. Hay que activarla a conciencia.

Es segura **en esta instalación concreta** porque en Authentik **solo los dos administradores (`fvalera` y `jgalvez`) pueden cambiar correos**. Un usuario normal no puede editar su perfil, así que no puede apuntar su correo a la cuenta de otro.

> ⚠️ **DE QUÉ DEPENDE ESTA DECISIÓN — revisar si cambia cualquiera de estas cosas:**
> - Si algún día se permite a los usuarios **editar su propio perfil** en Authentik.
> - Si se añade un **flujo de auto-registro** (enrollment) que deje elegir el correo.
> - Si se conecta una **fuente de identidad federada** (hoy `sources: []`, verificado).
>
> En cualquiera de esos casos, esta variable vuelve a `false` y hay que buscar otra
> forma de vincular. **El día que se active, se documenta aquí la fecha y quién lo pidió.**

**Mitigación permanente:** el paso (b) ocurre **una sola vez por persona**. En cuanto se escribe el `oidc_sub`, el correo deja de mirarse para siempre. La ventana de riesgo es el primer acceso de cada persona, no una condición permanente.

### Detalles no negociables de implementación

- El paso (b) va en **una transacción** con `SELECT … FOR UPDATE`, para que dos callbacks simultáneos no escriban `oidc_sub` distintos en la misma fila.
- El `UPDATE` lleva **`AND oidc_sub IS NULL`** como red de seguridad.
- **Nunca un `UPSERT`/`ON CONFLICT DO UPDATE` sobre `users`.** Si la persona ya existe, un upsert le sustituiría el `password_hash` y la dejaría fuera. En `track-flota` estuvo a punto de pasar. Alta = `INSERT … ON CONFLICT DO NOTHING` + relectura, o `INSERT` a secas dentro de la transacción.
- `sub` se compara tal cual, sin normalizar. El correo, en minúsculas por ambos lados.
- Si `claims.email` viene vacío o ausente → se cae directo a (c). No se inventa nada.

---

## 6. El desconocido en Authentik — absorbido por B0

Con una sola fila en la tabla, este caso **no es la excepción: es el 100% de los intentos** hasta que existan las altas. Deja de ser una decisión independiente.

- **Si eliges A:** el callback responde denegando, con mensaje claro y sin crear sesión. El alta es un `INSERT` a mano, como hoy. Se registra en el log del servidor quién lo ha intentado, para que las altas que faltan se vean.
- **Si eliges B:** esta sección desaparece; el paso (c) crea la fila (con `INSERT`, **no upsert**) y entra.

**Mientras no respondas: denegar con mensaje claro**, que es lo que pediste como interino. No se construye ninguna tabla `pending_users` ni pantalla de administración.

---

## 7. La `redirect_uri` — REESCRITO en v2

**La v1 la derivaba de `x-forwarded-proto`/`x-forwarded-host`, siguiendo el encargo original. Tu instrucción nueva lo sustituye: absoluta, de variable de entorno, nunca `req.host`. Lo aplico, y es mejor.**

- **`OIDC_REDIRECT_URI` es obligatoria** cuando OIDC está activo. Valor fijo, absoluto, https, el de producción.
- **No hay derivación desde cabeceras. Ninguna.** Ni como respaldo. Un respaldo que solo se dispara cuando el proxy se comporta raro es un camino que nunca se prueba y que falla el día peor.
- Se usa **la misma cadena** en `/auth/oidc/login` y en el canje del `/auth/oidc/callback`. Si difieren aunque sea en una barra final, Authentik responde `redirect_uri_mismatch`.
- Al arrancar se imprime en el log:
  `OIDC redirect_uri: https://… — debe coincidir EXACTAMENTE con la de Authentik`
  Así el desajuste se ve en el arranque, no cuando alguien intenta entrar.
- Para reconstruir la URL completa que la v6 necesita en el canje, se usa
  `OIDC_REDIRECT_URI + '?' + query de la petición`, **no** `req.protocol`/`req.get('host')`.

**Efecto secundario bueno:** el problema de las cabeceras del proxy desaparece del diseño. Ya no importa si Traefik manda `X-Forwarded-*` ni que `nginx.conf` esté muerto. `trust proxy: 1` se queda como está porque lo necesita la cookie `secure`, no la redirect URI.

---

## 8. Cambios en `server.js` — inventario cerrado

| # | Dónde | Qué | Riesgo |
|---|-------|-----|--------|
| 1 | `initDB()`, `server.js:22-52` | `ALTER TABLE users ADD COLUMN IF NOT EXISTS oidc_sub TEXT UNIQUE;` en el mismo bloque, siguiendo el patrón existente | Nulo. Idempotente |
| 2 | Arranque `async` | `const oidc = await import('openid-client')` **solo si OIDC está configurado** | Nulo |
| 3 | Tras `initDB()` | Config OIDC: valida las cuatro variables, `discovery()` **una vez**, cachea. Si el discovery falla: log de error y **OIDC desactivado, la app sigue arrancando** — Authentik caído no puede tumbar el login local ni a `admin` | Bajo |
| 4 | `server.js:112-117` | `sameSite: 'strict'` → `'lax'` | **Ver §11.** Imprescindible |
| 5 | Nuevo, fuera de `/api` | `GET /auth/oidc/login` | Nulo, ruta nueva |
| 6 | Nuevo, fuera de `/api` | `GET /auth/oidc/callback` | Nulo, ruta nueva |
| 7 | `server.js:146-148` | `POST /api/logout`: si `req.session.oidc`, devolver `{ok:true, redirect:<end_session_url>}`. Si no, `{ok:true}` como hoy | Bajo. El camino local no cambia |
| 8 | Nuevo | `GET /api/aviso` (público) | Nulo |
| 9 | `server.js:152` | `const publica = ['/login','/me','/aviso'];` | **Única línea del middleware que se toca** |

**Lo que NO se toca, y ahora sin excepciones:** `POST /api/login` **entero**, `bcrypt` y las contraseñas guardadas, la fila de `admin`, `bootstrapAdmin()`, y la lógica de `req.session.userId` del middleware.

### API de la v6 que se va a usar

```
oidc.discovery(new URL(issuer), clientId, clientSecret)
oidc.randomPKCECodeVerifier() / oidc.calculatePKCECodeChallenge(v)
oidc.randomState() / oidc.randomNonce()
oidc.buildAuthorizationUrl(config, { redirect_uri, scope, state, nonce, code_challenge, code_challenge_method:'S256' })
oidc.authorizationCodeGrant(config, url, { pkceCodeVerifier, expectedState, expectedNonce })
  → tokens.claims()   // firma, iss, aud, exp y nonce ya validados contra el JWKS
oidc.buildEndSessionUrl(config, { id_token_hint, post_logout_redirect_uri })
```

### Detalles del callback

- `state`, `nonce` y `code_verifier` se guardan en `req.session` en `/login` y se **borran nada más usarlos**. Un solo uso.
- `state` ausente o distinto → 400, **sin canjear nada**.
- Todo el intercambio es servidor↔Authentik. **El token nunca llega al navegador.** Lo único que el navegador recibe es la cookie de sesión de siempre.
- **`req.session.regenerate()` antes de rellenar la sesión** (fijación de sesión). Ojo: `regenerate` vacía la sesión, así que `state`/`nonce`/`verifier` hay que leerlos a variables locales **antes** de llamarlo.
- Se guarda `req.session.oidc = { idToken, sub }` para el logout.
- **DESVIACIÓN respecto al plan (v4):** los errores **no** redirigen a `/?auth_error=<código>`; se sirve una página de error mínima desde el servidor con el código HTTP real (400 / 403 / 500 / 503). Dos motivos: da los códigos de estado que el guion de verificación necesita, y evita añadir manejo de `auth_error` en `esims.html`, que es lo que se quería tocar lo mínimo posible. **Nunca se vuelca el error crudo de Authentik al navegador**; los textos son fijos y el detalle va al log del servidor.

### Migración SQL (para que la apliques tú — yo no toco la base de datos)

```sql
-- 1. Vinculación de identidad OIDC. Única sentencia de esquema del proyecto.
ALTER TABLE users ADD COLUMN IF NOT EXISTS oidc_sub TEXT UNIQUE;

-- 2. Altas de las personas (opción A). Una línea por persona.
--    password_hash = bcrypt de 64 bytes aleatorios descartados: la fila NO puede
--    entrar por el login local, solo por Authentik. Ver §1bis.
--    ON CONFLICT DO NOTHING, NUNCA DO UPDATE: si la persona ya existiera,
--    un upsert le pisaría el hash y la dejaría fuera (trampa nº4).
--    Los hashes se generan al recibir la lista (B8) — uno DISTINTO por persona.
-- INSERT INTO users (username, password_hash)
-- VALUES ('nombre.apellido@avanzasolutions.es', '$2b$10$…')
-- ON CONFLICT (username) DO NOTHING;
```

**No hay `ALTER COLUMN password_hash DROP NOT NULL`.** La v2 lo proponía; ya no hace falta (§1bis).

La sentencia 1 va además dentro de `initDB()`, así que en el próximo arranque se aplica sola. **La 2 va comentada a propósito: la genero al recibir B8 y la ejecutas tú.**

---

## 9. Cambios en `esims.html` — lo mínimo, sin reorganizar nada

| # | Dónde | Qué | Líneas aprox. |
|---|-------|-----|---------------|
| 1 | Dentro de `#login-overlay`, tras el `<form>` (~`esims.html:210`) | Separador + `<a href="/auth/oidc/login">Entrar con la cuenta de Avanza</a>` + `<div id="aviso-login">` vacío | ~12 |
| 2 | Primer elemento del `<body>` (~`esims.html:186`) | `<div id="aviso-barra" role="alert" hidden>` para la app ya logueada | ~8 |
| 3 | Bloque `<style>` | Reglas de `#aviso-barra` **y el arreglo de scroll del §9bis** | ~12 |
| 4 | `init()`, `esims.html:895-908` | Al final: `fetch('/api/aviso')`, pintar, y mostrar u ocultar el botón según `oidcEnabled` | ~15 |
| 5 | `logout()`, `esims.html:945-948` | `location.href = data.redirect \|\| location.pathname` en vez de `location.reload()` | 2 |

**Nada de reescribir el fichero. Nada de tocar `handleLogin()` ni el formulario local.**

### La barra: `sticky`, no `fixed`

El navbar (`esims.html:221`) **no** es `fixed`. Poner la barra como `position:fixed` obligaría a meter `padding-top` al `body` y recalcularlo por breakpoint — justo lo que puede descolocar un fichero frágil.

Propuesta: **primer elemento del `<body>`, `position:sticky; top:0; z-index:1030`**. Efecto idéntico para el usuario, cero cambios de layout.

### Accesibilidad (no solo el color)

- `role="alert"` en los dos sitios.
- **Icono** `bi-exclamation-triangle-fill` + **encabezado en negrita** ("Cambio en el acceso"): el mensaje no depende del rojo.
- Fondo `#b02a37` con texto blanco ≈ **6.4:1**, por encima del 4.5:1 de WCAG AA. El `#dc3545` de Bootstrap sobre blanco **no** llega; por eso el tono oscuro.
- Fuente ≥ 1rem. La barra **no se puede cerrar**: es un aviso, no una notificación.

### `GET /api/aviso`

Público. Devuelve:

```json
{ "fecha": "1 de octubre de 2026",
  "recoveryUrl": "https://auth.avanzafibra.net/if/flow/password-recovery/",
  "oidcEnabled": true }
```

`fecha: null` si `AVISO_AUTHENTIK_FECHA` no está puesta → **el frontend no pinta nada**, ni en el overlay ni en la barra.

### Texto del aviso — ya se puede cerrar (B4 resuelto)

```
⚠  Cambio en el acceso

El {{FECHA}} el inicio de sesión pasa a ser con la cuenta de Avanza.

· Entra YA con el botón «Entrar con la cuenta de Avanza» para comprobar que te funciona.
· Usa tu correo @avanzasolutions.es o @avanzafibra.com.
· Todavía no tienes contraseña. Créate una aquí: [Crear mi contraseña de Avanza]
  → https://auth.avanzafibra.net/if/flow/password-recovery/
```

**Ya no se cita ningún rótulo de Authentik.** El aviso lleva su propio enlace directo, así que el texto no se rompe si alguien cambia un nombre allí — que era justo el riesgo, y además resulta que **ese enlace no existe** en la pantalla de login (§1ter).

> ⚠️ **El aviso no se enciende hasta que (1) existan las filas de las personas, (2) se
> haya comprobado con una cuenta real que el botón funciona, y (3) esté confirmado que
> el correo de recuperación llega (B3).** El interruptor `AVISO_AUTHENTIK_FECHA` es lo
> que garantiza esto: basta con no ponerla antes de tiempo.

---

## 9bis. Trampas heredadas de `track-flota` (nuevo en v2)

Cinco cosas que allí costaron tiempo. Cuatro ya están comprobadas contra este código.

| # | Trampa | ¿Está aquí? | Qué se hace |
|---|--------|-------------|-------------|
| 1 | `email_verified:false` deja fuera a todo el mundo | **Sí, aplica** | §5, variable explícita |
| 2 | Falta la Signing Key → `id_token` en HS256 → login roto | Aplicará al crear el Provider | §1ter, en la lista de ajustes |
| 3 | `password_hash NOT NULL` y filas sin contraseña | **Esquivada.** Aquí no se crean filas sin contraseña | §1bis: hash bcrypt aleatorio. Sin `ALTER`, sin tocar el login |
| 4 | Upsert sobre `users` que pisa el hash de alguien existente | Riesgo al escribir el alta | §5, `INSERT` nunca `UPSERT` |
| 5 | **El aviso empuja el login fuera de la vista y no se puede desplazar** | **SÍ, VERIFICADO. Ver abajo** | Arreglo de 2 propiedades |

### La trampa nº 5, confirmada en este código

`esims.html:164-168`:

```css
#login-overlay {
  position: fixed; inset: 0; z-index: 9999;
  display: flex; align-items: center; justify-content: center;
}
```

`position:fixed` + `inset:0` + `align-items:center` y **sin `overflow`**. Es exactamente el patrón que dejó el login inaccesible en `track-flota`: cuando el contenido crece más que el viewport, un item centrado con flexbox **desborda por arriba y por abajo**, y el desbordamiento superior **es inalcanzable** — el contenedor no tiene `overflow:auto`, así que no hay nada que desplazar.

Y va a crecer: la tarjeta actual mide **~360 px**; con el bloque del aviso (encabezado + 3 viñetas + enlace) más el separador y el botón nuevo se va a **~640 px**. En un portátil de 1366×768 el viewport útil ronda los **620 px**. **Se corta**, y no es hipotético.

Arreglo, dos propiedades, sin tocar el HTML:

```css
#login-overlay { overflow-y: auto; align-items: flex-start; padding: 1.5rem 1rem; }
.login-card    { margin: auto; }   /* centra si cabe, no recorta si no cabe */
```

`margin:auto` en el hijo de un contenedor flex centra vertical y horizontalmente **cuando hay sitio**, y cuando no lo hay se comporta como un bloque normal que sí se puede desplazar. Es el arreglo estándar de este defecto.

**Se verifica a 1366×768 y a 360×640 antes de dar la Parte B por hecha** (§12, punto 18).

---

## 10. Orden de ejecución

```
0. BLOQUEANTES  ─ B0, B0b y B8 cerrados. Quedan B3 y B9, que NO frenan
                  el código: solo el encendido del aviso.   ← estamos aquí
1. Authentik    ─ Creas Application + Provider `gestion-esims` (§1ter).
                  Se comprueba con el .well-known, que hoy da 404
2. Migración    ─ `migracion-authentik.sql`, ya generado. Lo aplicas tú.
   + ALTAS        Incluye el ALTER y los 9 INSERT. El ALTER va además en
                  initDB(). Antes de esto el botón no sirve para nadie
3. Dependencia  ─ npm i openid-client@^6.8.5
4. server.js    ─ config + interruptor + discovery. Sin rutas todavía.
                  ▸ Comprobación: sin OIDC_*, la app arranca idéntica a hoy
5. server.js    ─ /auth/oidc/login + /auth/oidc/callback + cookie a 'lax'
                  ▸ Comprobación: login local intacto; login OIDC crea sesión
6. server.js    ─ logout con end_session + GET /api/aviso
7. esims.html   ─ los 5 puntos del §9 + el arreglo de scroll del §9bis
8. VERIFICA.md  ─ guion curl del §12, ejecutado de verdad
9. AVISO        ─ Solo tras B3 confirmado y probado con cuenta real:
                  pones AVISO_AUTHENTIK_FECHA
```

Cada paso es desplegable por separado. Los pasos 2–4 no cambian **ningún** comportamiento visible.

---

## 11. `sameSite: 'strict'` → `'lax'`

**Confirmado en producción en `track-flota`. Es determinista, no opcional.** La vuelta desde Authentik es una navegación *top-level* iniciada desde otro sitio; con `Strict` ningún navegador manda la cookie. Sin cookie no hay sesión; sin sesión no están el `state` ni el `code_verifier`. El login por Authentik fallaría **siempre**.

**Qué se pierde con `Lax`:** que la cookie viaje en navegaciones top-level **GET** desde otro origen. Si alguien enlaza a `https://esims.avzdev.com/` desde otra web y lo pulsas, llegas con la sesión iniciada. Eso es todo.

**Qué NO se pierde:** `Lax` sigue **sin** mandar la cookie en `POST` cross-site, ni en `fetch`/`XHR`, ni en `<img>`, ni en iframes. La protección CSRF de `POST /api/esims`, `PUT`, `DELETE` y `POST /api/send-email` **es la misma que con `Strict`**. Se suman `X-Frame-Options: DENY` y `frame-ancestors 'none'`, ya presentes.

`httpOnly` y `secure` no se tocan.

---

## 12. Guion de verificación manual (`VERIFICA.md`, paso 8)

No hay runner de tests: se hace con `curl` y **se ejecuta de verdad**, no se entrega escrito y sin correr.

| # | Qué se comprueba | Resultado esperado |
|---|------------------|--------------------|
| 1 | **El login local sigue funcionando** (`POST /api/login`) | `200 {"ok":true}` + cookie |
| 2 | La sesión local sirve para todo (`GET /api/esims` con cookie) | `200` con el array |
| 3 | `/api/*` sigue dando 401 sin sesión (`esims`, `send-email`, `PUT`) | `401` en las tres |
| 4 | `/aviso` es pública | `200` sin cookie |
| 5 | **Sin variables OIDC la app arranca igual que hoy** | Arranque limpio, `404` en `/auth/oidc/login`, `oidcEnabled:false` |
| 6 | Configuración a medias falla al arrancar | `exit 1` + `falta OIDC_REDIRECT_URI` |
| 7 | `/auth/oidc/login` redirige bien | `302` con `code_challenge`, `code_challenge_method=S256`, `state`, `nonce` |
| 8 | El callback rechaza `state` falso | `400`, **sin** llamada al token endpoint |
| 9 | El callback rechaza sin `state` | `400` |
| 10 | **Login por Authentik crea sesión válida** (navegador) | `/api/me` responde `200` con el `username` correcto |
| 11 | **Un usuario desconocido NO entra** | Denegado, **sin cookie**, y `/api/esims` sigue dando `401` |
| 12 | El `sub` gana al correo | Cambiar el correo en Authentik de alguien ya vinculado y reentrar → entra en **su misma fila** |
| 13 | **Con `OIDC_VINCULAR_SIN_EMAIL_VERIFICADO` en `false` nadie nuevo se vincula** | Cae en la rama de denegado. Es la comprobación de que la variable hace algo |
| 14 | La sesión se regenera | Id de cookie distinto antes y después del callback |
| 15 | El logout OIDC pasa por `end_session` | `{ok:true, redirect:"…/end-session?id_token_hint=…"}` |
| 16 | El logout local no cambia | `{ok:true}` sin `redirect` |
| 17 | **`admin` sigue entrando con su contraseña de siempre** | `200`. Es LA comprobación de que no se ha roto el acceso de hoy |
| 18 | **Una fila de persona NO entra por el login local** | `POST /api/login` con su correo y contraseñas varias (`""`, `admin`, `1234`…) → `401` **siempre**. Comprobado ya a nivel de bcrypt en §1bis; aquí se comprueba de punta a punta |
| 19 | **El aviso no deja el login inaccesible** | A 1366×768 y 360×640: el botón "Entrar" **alcanzable**, con scroll si hace falta |
| 20 | **Authentik caído no rompe el login local** | Apagar el discovery: la app arranca, `admin` entra, el botón OIDC da error claro |
| 21 | **(B3) El correo de recuperación llega** | En **ventana de incógnito** (con sesión iniciada Authentik deniega el flujo): el correo llega a la bandeja |
| 22 | **(B9) Los 9 correos de Authentik coinciden con los 9 de `users`** | Uno a uno en Authentik. Cualquier diferencia = esa persona se queda fuera el día del corte |

Los puntos 10–14 y 19–21 necesitan navegador. **Se documentan como pasos manuales; no se fingen con curl.**

---

## 13. Supuestos que quedan

1. ~~Authentik emite `email_verified: true`.~~ **FALSO, verificado: envía `false`.** Ver §5.
2. El `sub` de Authentik es **estable de por vida** y no cambia al renombrar al usuario. Reforzado por el Subject mode "Based on the User's hashed ID" (§1ter).
3. **Quién puede usar la aplicación se controla con el binding de grupo de Authentik.** Aquí no habrá listas de correos ni de dominios en el código.
4. La app se sirve **solo** desde `https://esims.avzdev.com`. **Confírmalo**: es el valor de `OIDC_REDIRECT_URI` y de la Redirect URI de Authentik, y tienen que ser idénticos.
5. ~~Traefik pone las `X-Forwarded-*`.~~ **Ya no importa:** la redirect URI es una variable (§7).
6. Node en producción es ≥ 20. Lo es (`node:20-alpine`), y la v6 con `await import()` funciona ahí (§3).
7. ~~La tabla `users` tiene pocas filas.~~ **Verificado: una, `admin`, compartida.** §1bis.
8. `AVISO_AUTHENTIK_FECHA` es una **cadena ya formateada** ("1 de octubre de 2026"), no una fecha ISO.
9. En Authentik **solo `fvalera` y `jgalvez` pueden cambiar correos**, y no hay auto-registro ni fuentes federadas (`sources: []`, verificado). **De esto depende la seguridad del §5.**

---

## 14. Lo que este plan NO hace

- **No toca el login local. Ni una línea.** `POST /api/login` se queda exactamente como está (§1bis).
- No toca las contraseñas guardadas. La de `admin` sigue funcionando igual.
- No cambia el esquema salvo **una** sentencia: `ADD COLUMN oidc_sub`.
- No borra ni migra usuarios. **Nunca hace `UPSERT` sobre `users`.**
- No reescribe `esims.html`. Toca 5 puntos y añade 2 propiedades CSS.
- No aplica ninguna migración en la base de datos: el SQL se entrega, lo ejecutas tú.
- No configura nada en Authentik: §1ter es una lista para que la apliques tú.
- No vincula el flujo de recuperación al Brand de Authentik (§1ter). Eso afecta a toda la organización.
- No construye flujo de aprobación ni administración de usuarios.
- No cambia el middleware de `/api` más allá de añadir `/aviso` a las públicas.
- No toca el `AUTH_TOKEN` de SIA, que no tiene nada que ver con esto.

---

---

## 15. Estado de la implementación (2026-08-17)

**Pasos 3 a 8 del §10: HECHOS.** Verificación en `VERIFICA.md` — **53 comprobaciones
ejecutadas, 53 correctas**, contra un Authentik falso con HTTPS, RS256 y JWKS reales,
ejercitando el `server.js` real.

| Fichero | Cambio |
|---|---|
| `package.json` | + `openid-client@^6.8.5` (única dependencia nueva) |
| `server.js` | +237 líneas: `ALTER` en `initDB()`, interruptor + discovery, `/auth/oidc/login`, `/auth/oidc/callback`, logout con `end_session`, `/api/aviso`, cookie a `'lax'` |
| `esims.html` | +90 líneas: arreglo de scroll del overlay, estilos del aviso, barra fija, bloque de aviso y botón OIDC en la tarjeta, `_cargarAviso()`, `logout()` |
| `migracion-authentik.sql` | Nuevo. **Lo ejecutas tú** |
| `VERIFICA.md` | Nuevo. Guion `curl` + los pasos de navegador |

**`POST /api/login` no se ha tocado.** Comprobado además de un vistazo: el guion verifica
que `admin` sigue entrando con su contraseña y que las filas nuevas no entran con ninguna.

### Pendiente, y no lo puedo hacer yo

0. ~~Aplicar `migracion-authentik.sql`~~ — **HECHO Y VERIFICADO el 2026-08-17.**
   10 filas: `admin` (id 1, con su `password_hash` intacto) + las 9 personas (id 2-10),
   todas con `oidc_sub` nulo a la espera del primer acceso. Ninguna se saltó por el
   `ON CONFLICT`. Fichero añadido a `.gitignore`; se puede borrar.
1. **B3** — que llegue el correo de recuperación (incógnito). Si no llega: **PARAR**.
2. **B9** — que los 9 correos de Authentik coincidan con los de `users`.
3. Crear la Application/Provider en Authentik (§1ter).
4. Los puntos N1–N12 de `VERIFICA.md`, que necesitan navegador. **N8 (que el aviso no deje
   el login inaccesible) y N11 (el correo) son los dos que no se pueden saltar.**
5. Poner `AVISO_AUTHENTIK_FECHA` **solo al final**, y `OIDC_VINCULAR_SIN_EMAIL_VERIFICADO=true`
   (sin ella no se vincula nadie: Authentik manda `email_verified:false`).

---

## 16. Roles y panel de administración (añadido el 2026-08-17)

Pedido después de cerrar el plan. Es **la opción 3 del §6**, la que en su momento descarté
por desproporcionada para una migración de login; con la petición explícita, se construye.

| Qué | Dónde |
|---|---|
| Columna `rol` + `CHECK (rol IN ('admin','usuario'))` | `initDB()` y `migracion-authentik-4.sql` |
| `GET/POST/PATCH/DELETE /api/admin/users` | `server.js`, con `exigirAdmin` |
| Modal «Administrador» + botón en la navbar | `esims.html` |
| Administradores iniciales | fvalera y jgalvez (`migracion-authentik-4.sql`) |

**El detalle que más importa:** al eliminar a alguien se le borran también las sesiones,
en la misma transacción. Sin eso seguiría dentro hasta 8 h, porque el middleware de `/api`
solo mira que exista `req.session.userId`, no que la fila siga viva. Y el rol se relee de
la base de datos en cada petición de administración, así que revocarlo surte efecto al
instante.

Detalle completo y guion de comprobación en `VERIFICA.md` §5bis y N13–N17.

### Mensaje de acceso denegado

Quien tenga permiso en Authentik pero no fila en `users` ve una página propia con
**«No tienes acceso — Tu cuenta de Avanza es correcta, pero no tiene acceso a Gestión de
eSIMs. Habla con tu responsable.»**, igual que en el resto de los proyectos. Con estilo de
la casa, `role="alert"` y sin filtrar al navegador ni el `sub` ni el correo del intento;
eso va solo al log del servidor.

### Coste en `esims.html`

El fichero pasa de +90 a **+291 líneas** sobre el original. Sigue sin reorganizarse nada:
son un botón en la navbar, un modal nuevo al final del `<body>` y un bloque de funciones.
Pero conviene decirlo: esto ya no es "tocar lo mínimo", es una funcionalidad entera.

---

> **Estado: implementado y verificado en local (91/91). Sin desplegar.**
> No se ha aplicado ninguna migración en la base de datos ni se ha tocado nada en Authentik.
