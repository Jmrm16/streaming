# Reglas críticas: reproducción, Modo Fluido y desbloqueo de red (DoH)

## 1. Reproducción y Modo Fluido (Zona Protegida)

La reproducción es una zona estrictamente protegida. No modificar, reemplazar,
simplificar ni eliminar código de reproducción salvo que el usuario diga explícitamente:
**"modificar reproducción"** o **"modificar Modo Fluido"**.

Para cambios visuales (menús, CSS, pantallas, foco, textos o diseño), editar
solamente los recursos visuales necesarios. No tocar estas rutas ni cambiar su
comportamiento:

- `webos/fidelity/js/app.js`: `streamMode`, `forceRelay`, `resolveSmooth`,
  `restartCurrentPlayback`, `playUrl`, seek y cambio de episodio.
- `webos/services/com.webosflux.xuptertv.fidelity.service/index.js`: rutas
  `resolve` y `resolveSmooth`, y la condición que llama `relay.register`.
- `webos/services/com.webosflux.xuptertv.fidelity.service/ffmpeg-relay.js`.
- `webos/services/com.webosflux.xuptertv.fidelity.service/ffmpeg`.

### Contrato obligatorio de reproducción:
- **Normal** usa el proxy directo (`proxy.baseUrl() + '/media/...'`).
- **Modo Fluido** usa obligatoriamente `resolveSmooth` y una URL local del relay:
  - webOS 4 en adelante (y versión de webOS desconocida):
    `http://127.0.0.1:8787/s/<token>.mp4` (MP4 fragmentado).
  - webOS 1/2/3 y 3.5 (autorizado 2026-11-04 con "modificar fluido"):
    `http://127.0.0.1:8787/t/<token>.ts` (MPEG-TS), porque el pipeline nativo de
    esas versiones no demuxa siempre el fMP4 y deja la pantalla en negro o el
    audio desincronizado. El contenedor lo elige la app (`relayContainer()` en
    `app.js`, `container` en el payload de `resolveSmooth`) y nunca cambia el
    camino Normal.
- **Modo Fluido nunca debe quedar en negro**: si el `<video>` no llega a
  `readyState >= 2` en 15 s, `watchdog de arranque` (`relayStartWatch`) vuelve a
  Normal una sola vez por título con aviso al espectador.
- Al instalar o actualizar la IPK, comprobar que `ffmpeg` conserva permiso
  ejecutable (`chmod 755 .../service/ffmpeg`). El empaquetador de Windows puede perderlo.

---

## 2. Evasión de bloqueos de red y censura DNS (DoH y camuflaje SNI)

En varios países y proveedores de internet (por ejemplo Chile, Cable Éxito, Claro,
Movistar, etc.), los operadores secuestran el puerto UDP 53 con reglas de filtrado
e inyectan respuestas envenenadas para bloquear el catálogo y las CDNs de video.
La arquitectura anti-bloqueo se basa en cuatro pilares obligatorios que **JAMÁS
deben simplificarse, omitirse ni eliminarse**:

1. **Resolución DoH obligatoria y previa (`resolveHostIp`):**
   - En `proxy.js`, ninguna conexión hacia el CDN abre un socket sin tener la IP
     IPv4 literal obtenida por DoH (Cloudflare, Google, AdGuard, AliDNS, DNS.SB, NextDNS).
   - Node.js en webOS conecta directamente a la IP Anycast (ej. `66.225.197.106` o
     `104.18.30.197`) sin tocar jamás el resolver nativo del televisor ni el puerto
     UDP 53 del operador chileno o local.
   - La lista de resolutores en `dnsx.js` debe mantener múltiples proveedores Anycast
     independientes de distintas nubes y continentes (Asia, Europa, América) para
     evitar que un bloqueo por IP en el puerto 443 anule la resolución.

2. **Conexión transparente con SNI real y camuflaje de respaldo (CacheFly):**
   - En `proxy.js`, `mediaRequest` usa primero el protocolo original de la CDN (`http` o `https`)
     sin forzar elevación a TLS y con el hostname real en el SNI (`servername: host`).
   - Si el CDN es de CacheFly y la conexión falla por bloqueo DPI del operador
     (reset TCP / timeout) o responde 403/451, `forward` reintenta una sola vez
     forzando HTTPS con `servername: 'cachefly.net'` (el camuflaje de la 1.6.17,
     necesario en redes como Claro Argentina o ETB).
   - En `forward` se mantiene el reintento adaptativo: HTTP que falla por DPI
     reintenta en HTTPS, y HTTPS que falla por la pila TLS antigua de webOS 1/2/3
     reintenta en HTTP.
   - El camuflaje es solo un respaldo: una red que no bloquee el nombre real
     sigue usando SNI real y conexión transparente.

3. **Flujo Modo Fluido protegido en webOS:**
   - En `index.js`, `resolveStream` pre-resuelve la IP por DoH antes de registrar la ruta.
   - FFmpeg lee primero del proxy local en `127.0.0.1` (conserva el camuflaje SNI y
     los reintentos del CDN); si ese camino no emite, reintenta contra el CDN
     directo. Entrega MP4 fragmentado limpio al elemento `<video>`.

4. **Verificación de permisos ejecutables:**
   - El binario `ffmpeg` conserva modo `0755` dentro del paquete IPK (`tools/fix_ipk_modes.py`).

5. **Rescate por semillas (bloqueo regional `portal100024`):**
   - En `magis.js` el pool de semillas se cachea en `/tmp/xuper-seeds.json`, se
     filtra por `exp`, se marca como muerto lo que el portal responde
     `aaa100027`/`aaa100028` y se reintenta con otra semilla ante
     `portal100024`.
   - No reducir el rescate a una sola semilla aleatoria: en países bloqueados
     es la única salida y varias semillas del pool pueden estar caducadas.
   - Las semillas son sesiones prestadas del plugin de referencia
     (`analysis/kino-plugin-xuper/src/session.js`); no son credenciales de usuario.

---

## 3. Protocolo de comprobación obligatorio antes de entregar

Antes de entregar cualquier cambio que afecte la app, comprobar:

1. `node --check` de todos los archivos JavaScript modificados.
2. `node scratch/verify_agents_rule.js` (verificación automática de componentes).
3. Que el modo fluido siga enviando `forceRelay` y llame `resolveSmooth`.
4. Que el servicio siga registrando `resolveSmooth` y llame `relay.register`.
5. Que `proxy.js` mantenga la resolución previa `resolveHostIp`, el SNI real y el camuflaje de respaldo `cachefly.net`.
6. Que `dnsx.js` conserve el pool multirresolutor DoH en paralelo.
7. Que el binario `ffmpeg` conserve modo `0755` dentro de la IPK construida.
8. Que `services.json` **no** declare `commands` (ver sección 4).
9. Que el autotest de `ffmpeg` siga diferido con `setTimeout` en `ffmpeg-relay.js`.
10. Que `magis.js` conserve el rescate por semillas (`portal100024`) con pool, expiración y marcas de semilla muerta.
11. Que ningún servicio declare una `function` dentro de un bloque (ver sección 5): webOS 3.x no carga el servicio.

Si una tarea visual requiere tocar alguna de estas rutas o módulos protegidos,
detenerse y pedir autorización explícita al usuario antes de hacerlo.

---

## 4. Registro del servicio Luna (causa de "el servicio no arrancó")

El bloque `"commands": [...]` dentro de `webos/services/com.webosflux.xuptertv.fidelity.service/services.json`
activa ACLs estrictas en `ls-hubd` y provoca `Denied method call for category /`
o que el servicio no responda al `ping` en varias versiones de webOS (3.x y 6.x).
Ya se eliminó dos veces en el historial (`e30aa9e`, `4bb57f9`); **no volver a añadirlo**.
Los métodos se registran en `index.js` con `service.register(...)` y Luna los expone sin esa lista.

Además, el autotest de `ffmpeg` no debe ejecutarse durante la carga del módulo:
en TVs de 1 GB (webOS 3.x) el arranque en frío más la copia de 31 MB a `/tmp`
pueden retrasar el primer `ping` más de 25 s y la app lo interpreta como
"el servicio no arrancó". Debe quedar diferido (`setTimeout(..., 4000)` en
`ffmpeg-relay.js`) para que el servicio responda primero a Luna.

El instalador (`tools/instalar-tv.ps1`) comprueba tras instalar que el servicio
exista y responde a `ping`; si no responde, indica desenchufar la TV 30 segundos.

---

## 5. Compatibilidad del JavaScript del servicio con V8 3.28 (webOS 3.x)

El servicio se ejecuta en el Node.js interno del televisor. webOS 3.x usa
**Node 0.12 / V8 3.28**, que en modo estricto (`'use strict'` en la cabecera de
cada archivo) **rechaza cualquier declaración de función dentro de un bloque**:

    SyntaxError: In strict mode code, functions can only be declared at top level
    or immediately within another function.

Una sola declaración de este tipo hace que `index.js` no se cargue, el servicio
no se registre y la app muestre "ping no respondió en 25 segundos (el servicio no
arrancó)". Los televisores nuevos (V8 moderno) lo aceptan, por eso el fallo solo
aparece en webOS 1/2/3.

Regla obligatoria en todos los `.js` del servicio (`index.js`, `netdiag.js`,
`magis.js`, `proxy.js`, `dnsx.js`, `ffmpeg-relay.js`, `ts-indexer.js`,
`upstream.js`):

    /* correcto */
    var doRequest = function (ipList, ipIndex) { ... };
    /* incorrecto dentro de if/try/for/catch/switch: */
    function doRequest(ipList, ipIndex) { ... }

Las funciones declaradas en el nivel superior del archivo o directamente dentro
de otra función siguen siendo válidas. El verificador
`scratch/verify_agents_rule.js` (comprobación 12) detecta declaraciones dentro de
bloques y el protocolo de la sección 3 exige que pase antes de entregar.

Además el servicio debe mantenerse en ES5 puro (sin `const`, `let`, `class`,
arrow functions, template strings, `Promise`, `Set`, `Map`, `.includes`,
`.startsWith`, `.endsWith`, parámetros por defecto ni `for...of`) y pasar:

    npx acorn@8 --ecma5 --silent <archivo>.js

Cuando se añada una función nueva dentro de un callback o un `try`, usar siempre
una expresión de función asignada a `var`.

Además, `index.js` carga los módulos con `loadModule()` (try/catch) y registra
`ping` con valores protegidos (`safeValue`). Si un módulo no se puede cargar en
el televisor, el servicio **igual responde a `ping`** e informa `loadErrors`
(módulo + mensaje) junto con `node` (versión real de Node.js de la TV). La app
muestra esa información en Diagnóstico → fila "Servicio XuperTV". El resto de
métodos afectados responde con el error exacto en lugar de quedarse sin
contestar, que es lo que produce "ping no respondió en 25 segundos".
