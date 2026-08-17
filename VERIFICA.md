# VERIFICA.md — comprobación de la integración con Authentik

> Fecha: 2026-08-17 · Acompaña a `PLAN-AUTHENTIK.md`
> No hay runner de tests en el proyecto. Esto es un guion manual con `curl`
> más los pasos que obligatoriamente necesitan navegador.

---

## 0. Antes de empezar

```bash
BASE="https://esims.avzdev.com"     # cámbialo si pruebas en otro sitio
```

**Requisito previo, no relacionado con OIDC:** `server.js` hace
`new Resend(process.env.RESEND_API_KEY)` al cargar el módulo, y el SDK **lanza si la
variable no está**. Sin `RESEND_API_KEY` la aplicación no arranca. Ya era así antes de
este cambio, pero conviene saberlo si montas una instancia de pruebas desde cero.

### Variables de entorno

| Variable | Cuándo | Valor |
|---|---|---|
| `OIDC_ISSUER` | Las cuatro, o ninguna | `https://auth.avanzafibra.net/application/o/gestion-esims/` |
| `OIDC_CLIENT_ID` | ” | del Provider de Authentik |
| `OIDC_CLIENT_SECRET` | ” | del Provider de Authentik |
| `OIDC_REDIRECT_URI` | ” | `https://esims.avzdev.com/auth/oidc/callback` |
| `OIDC_VINCULAR_SIN_EMAIL_VERIFICADO` | **Obligatoria en la práctica** | `true` — ver §4 |
| `AVISO_AUTHENTIK_FECHA` | Solo al encender el aviso | `1 de octubre de 2026` |
| `AVISO_AUTHENTIK_RECOVERY_URL` | Opcional | por defecto el flujo de recuperación de Authentik |

---

## 1. Lo que NO puede haberse roto (ejecútalo siempre)

```bash
# 1. El login local sigue funcionando  → 200 + cookie
curl -s -o /dev/null -w '%{http_code}\n' -c c.txt \
  -X POST -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"LA-DE-SIEMPRE"}' $BASE/api/login

# 2. La sesión local sirve para todo    → 200
curl -s -o /dev/null -w '%{http_code}\n' -b c.txt $BASE/api/esims

# 3. /api/* sigue cerrado sin sesión     → 401, 401, 401
curl -s -o /dev/null -w '%{http_code}\n' $BASE/api/esims
curl -s -o /dev/null -w '%{http_code}\n' -X POST $BASE/api/send-email
curl -s -o /dev/null -w '%{http_code}\n' -X PUT  $BASE/api/esims/x

# 4. /api/aviso es pública               → 200
curl -s $BASE/api/aviso

# 5. Contraseña incorrecta               → 401
curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"loquesea"}' $BASE/api/login
```

**Si el punto 1 no da 200, para y revierte.** Es la única regla que no admite matices.

---

## 2. Las 11 filas de personas no pueden entrar por el login local

Sus `password_hash` son bcrypt de 64 bytes aleatorios descartados. Ninguna contraseña
puede casar. Prueba con varias:

```bash
for p in "" "1234" "admin" "password" "avanza"; do
  printf '%-10s -> ' "$p"
  curl -s -o /dev/null -w '%{http_code}\n' \
    -X POST -H 'Content-Type: application/json' \
    -d "{\"username\":\"alinares@avanzafibra.com\",\"password\":\"$p\"}" $BASE/api/login
done
```

Esperado: **401** en todos… salvo la contraseña vacía, que da **400**
(`Credenciales requeridas`). Los dos deniegan; el 400 es comportamiento
**preexistente** de `/api/login`, que no se ha tocado.

---

## 3. El interruptor

```bash
# Sin NINGUNA variable OIDC_*  → la app arranca igual que siempre
curl -s -o /dev/null -w '%{http_code}\n' $BASE/auth/oidc/login   # 404
curl -s $BASE/api/aviso                                          # "oidcEnabled":false
```

```bash
# Con la configuración A MEDIAS → el arranque debe fallar nombrando la que falta
OIDC_ISSUER=https://x/ OIDC_CLIENT_ID=y node server.js
# Esperado: exit 1 y  "Configuración OIDC incompleta: falta OIDC_CLIENT_SECRET, OIDC_REDIRECT_URI"
```

---

## 4. `OIDC_VINCULAR_SIN_EMAIL_VERIFICADO` — leer antes de tocar

**Authentik envía `email_verified: false`.** Con la variable en `false` (el valor por
defecto) **nadie que no tenga ya `oidc_sub` se vincula**, y el botón deniega a todo el
mundo. Es intencionado: hay que activarla a conciencia.

Activarla es seguro **mientras en Authentik solo los administradores puedan cambiar
correos**. Deja de serlo si algún día se permite a los usuarios editar su perfil, se
añade auto-registro, o se conecta una fuente federada. Ver `PLAN-AUTHENTIK.md` §5.

Comprobación de que la variable hace algo: con ella en `false`, el flujo completo de una
persona todavía sin vincular debe terminar en **403**.

---

## 5. El flujo OIDC (curl)

```bash
# /auth/oidc/login redirige a Authentik con PKCE  → 302
curl -s -o /dev/null -w '%{http_code}\n' -c o.txt $BASE/auth/oidc/login
curl -s -o /dev/null -w '%{redirect_url}\n' -c o.txt $BASE/auth/oidc/login
# La URL debe contener: response_type=code, code_challenge=, code_challenge_method=S256,
#                       state=, nonce=, scope=openid email profile

# El callback rechaza un state falso, y NO llega a canjear nada  → 400
curl -s -o /dev/null -w '%{http_code}\n' -b o.txt "$BASE/auth/oidc/callback?code=x&state=falso"
curl -s -o /dev/null -w '%{http_code}\n' -b o.txt "$BASE/auth/oidc/callback?code=x"
```

---

## 5bis. Roles y panel de administración

Dos roles: `usuario` (ve el panel de eSIMs, igual que hoy) y `admin` (además, gestiona
usuarios). El rol vive en `users.rol`, con `CHECK (rol IN ('admin','usuario'))` en la
propia base de datos. Administradores iniciales: **fvalera y jgalvez**.

```bash
# Con sesión de usuario NORMAL  → 403 en las cuatro
curl -s -o /dev/null -w '%{http_code}
' -b c.txt $BASE/api/admin/users
curl -s -o /dev/null -w '%{http_code}
' -b c.txt -X POST   -H 'Content-Type: application/json' -d '{"username":"x@y.es"}' $BASE/api/admin/users
curl -s -o /dev/null -w '%{http_code}
' -b c.txt -X PATCH  -H 'Content-Type: application/json' -d '{"rol":"admin"}' $BASE/api/admin/users/2
curl -s -o /dev/null -w '%{http_code}
' -b c.txt -X DELETE $BASE/api/admin/users/2

# Sin sesión  → 401 (no 403: primero autenticar, luego autorizar)
curl -s -o /dev/null -w '%{http_code}
' $BASE/api/admin/users

# Con sesión de ADMIN
curl -s -b adm.txt $BASE/api/admin/users     # 200, sin password_hash ni oidc_sub
```

### Decisiones de diseño que conviene conocer

**El rol se relee de la base de datos en cada petición de `/api/admin/*`**, no se toma de
la sesión. Si le quitas el rol a alguien, deja de ser administrador **al instante**, no
cuando le caduque la sesión de 8 h.

**Al eliminar a alguien se le borran también las sesiones** (`DELETE FROM session WHERE
(sess->>'userId') = …`, en la misma transacción que el `DELETE FROM users`). Sin eso
seguiría dentro hasta 8 h después: el middleware de `/api` solo comprueba que exista
`req.session.userId`, no que la fila siga viva.

**Barreras contra quedarse fuera**, todas devuelven 400:

| No se puede | Por qué |
|---|---|
| Cambiar tu propio rol | Es la forma más fácil de autodegradarse y perder el panel |
| Eliminar tu propia cuenta | Ídem |
| Quitar el último administrador | Dejaría la aplicación sin nadie que pueda administrar |
| Eliminar la cuenta `admin` | Es el acceso de emergencia que no depende de Authentik |

**Los usuarios creados desde el panel no tienen contraseña local**: se les pone un bcrypt
de 64 bytes aleatorios descartados, igual que en las altas por SQL. Entran **solo** por
Authentik. El correo se valida con un patrón y se guarda en minúsculas, porque el
emparejamiento va contra el claim `email`.

**La cuenta `admin` se queda con rol `usuario` a propósito.** Darle permisos de
administración significaría que una contraseña compartida puede dar y quitar accesos. Si
Authentik cae y hace falta administrar, el camino es SQL en Supabase — esa es la puerta de
emergencia real. Se cambia con una línea, documentada en `migracion-authentik-4.sql`.

---

## 6. Lo que SOLO se puede comprobar con navegador

`curl` no puede pasar por el login interactivo de Authentik.

| # | Comprobación | Esperado |
|---|---|---|
| N1 | Entrar con el botón «Entrar con la cuenta de Avanza» con una de las 11 cuentas | Entra en la aplicación, y el navbar muestra **su correo**, no `admin` |
| N2 | En Supabase, esa fila ya tiene `oidc_sub` | No nulo, un hash largo |
| N3 | Volver a salir y entrar | Entra igual, ahora emparejando por `oidc_sub` |
| N4 | Cambiar el correo de esa persona en Authentik y volver a entrar | Entra en **su misma fila**. No se crea otra ni se secuestra ninguna |
| N5 | Una cuenta de Authentik sin fila en `users` | Página **«No tienes acceso — habla con tu responsable»**. **Sin sesión** |
| N6 | Cerrar sesión con una sesión de Authentik | Pasa por el `end_session` de Authentik |
| N7 | Cerrar sesión con la cuenta `admin` (login local) | Recarga y vuelve al login, como siempre |
| N8 | **Con `AVISO_AUTHENTIK_FECHA` puesta**, a 1366×768 y a 360×640 | El aviso se ve **y el botón «Entrar» sigue alcanzable**, con scroll si hace falta |
| N9 | Con sesión ya iniciada | La barra roja aparece arriba, fija, y no tapa el navbar |
| N10 | El enlace «créate una aquí» del aviso | Abre el flujo de recuperación de Authentik |
| N11 | **(B3)** En ventana de **incógnito**, pedir recuperar contraseña | **El correo llega.** Con sesión iniciada Authentik deniega el flujo, por eso incógnito |
| N13 | Entrar como **fvalera o jgalvez** | Aparece el botón «Administrador» en la navbar |
| N14 | Entrar con cualquiera de los otros 9 | **NO** aparece ese botón |
| N15 | Abrir el panel, añadir un usuario, cambiarle el rol y eliminarlo | Funciona, y la tabla se refresca sola |
| N16 | En el panel, tu propia fila | Lleva la etiqueta «tú», con el desplegable y el botón de borrar **deshabilitados** |
| N17 | El panel a 360×640 | La tabla se desplaza en horizontal dentro de su contenedor, sin romper el modal |
| N12 | **(B9)** Los 11 correos de Authentik coinciden con los de `users` | Idénticos. **Ojo: `fvalera` y `jgalvez` son `@avanzasolutions.es`, los otros 9 `@avanzafibra.com`.** Cualquier diferencia deja fuera a esa persona |

> **N8 y N11 son los dos que no se pueden saltar.** N8 porque el aviso crece la tarjeta de
> acceso y ese es el fallo que dejó el login inaccesible en `track-flota`. N11 porque si el
> correo no llega, el aviso manda a la gente a un callejón sin salida.

---

## 7. En Authentik

- [ ] Application + Provider con slug **`gestion-esims`** creados
      (`/application/o/gestion-esims/.well-known/openid-configuration` deja de dar 404)
- [ ] El slug coincide **exactamente** con el que va en `OIDC_ISSUER`
- [ ] Client type **Confidential**
- [ ] **Signing Key puesta.** Si falta, el `id_token` va en HS256 y el login falla
- [ ] PKCE **S256**
- [ ] Scopes `openid`, `email`, `profile`
- [ ] «Include claims in id_token» activado
- [ ] Subject mode **Based on the User's hashed ID**
- [ ] Redirect URI = `https://esims.avzdev.com/auth/oidc/callback`, exacta
- [ ] **También la raíz** `https://esims.avzdev.com/` en las redirect URIs permitidas:
      el logout manda `post_logout_redirect_uri` y Authentik rechaza las no registradas
- [ ] El binding de grupo deja entrar a quien tiene que entrar

---

## 8. Lo ya verificado en local (2026-08-17)

Se montó un banco de pruebas —Authentik falso con **HTTPS, firma RS256 y JWKS reales**,
y un `pg` en memoria— y se ejecutó el `server.js` **real**, sin modificarlo, contra él.

**Resultado: 91 comprobaciones, 91 correctas.** Cubren:

| Bloque | Qué se ejerció |
|---|---|
| Sin OIDC | Login local, `/api/*` cerrado, `/api/aviso` pública, `/auth/oidc/*` inexistente, logout sin `redirect` |
| Config a medias | `exit 1` nombrando `OIDC_CLIENT_SECRET` y `OIDC_REDIRECT_URI` |
| Contraseñas | Las filas sin contraseña usable dan 401 con `1234`, `admin`, etc. `admin` sigue entrando |
| PKCE | `code_challenge`, `S256`, `state`, `nonce`, `response_type=code` en la URL de autorización |
| Callback | `state` falso → 400 · `state` ausente → 400 · canje y validación del `id_token` contra el JWKS |
| Vinculación | Con la variable en `false` nadie se vincula (403) · en `true` se vincula y se **escribe el `oidc_sub`** |
| Desconocido | 403 con «No tienes acceso / habla con tu responsable», sin sesión, sin crear fila, y **sin filtrar el `sub` ni el correo al navegador** |
| Fijación de sesión | El id de cookie **cambia** tras el callback, y la sesión nueva es válida |
| Logout | Con sesión OIDC devuelve `redirect` al `end_session` con `id_token_hint`; con sesión local, no |
| Authentik caído | La app arranca, `admin` entra, `oidcEnabled` pasa a `false` y el botón da 503 en vez de colgarse |
| Roles | Un usuario normal recibe 403 en los cuatro endpoints de administración; sin sesión, 401 |
| Panel | Alta (201), duplicado (409, nunca upsert), usuario que no es correo (400), y que el nuevo **no** entra por login local |
| Barreras | Cambiarse el rol, autoeliminarse, borrar la cuenta de emergencia y quedarse sin el último administrador: 400 en los cuatro |
| Revocación | Degradado a alguien, deja de administrar en la siguiente petición (el rol se relee de la BD) |
| Sesiones | Al eliminar a una persona, **su sesión deja de valer al instante**, no a las 8 h |

**Lo que ese banco NO prueba** y por eso está la §6: el Authentik real (sus claims, su
Signing Key, su binding de grupo), el navegador, y el aspecto visual del aviso.

### También comprobado

- `esims.html`: el único bloque `<script>` en línea (1.096 líneas) parsea sin errores y
  los `<div>` quedan equilibrados (139/139).
- `npm audit`: 2 vulnerabilidades (`body-parser`, `brace-expansion`), **ambas transitivas
  y preexistentes**. Ninguna proviene de `openid-client`.
