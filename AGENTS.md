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
- **Modo Fluido** usa obligatoriamente `resolveSmooth` y una URL local
  `http://127.0.0.1:8787/s/<token>.mp4`.
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

2. **Cifrado HTTPS con camuflaje SNI para CacheFly:**
   - Tanto en películas VOD como en segmentos de TV en vivo servidos por CacheFly,
     la conexión se eleva automáticamente a HTTPS (puerto 443) utilizando
     `servername: 'cachefly.net'`.
   - El operador solo ve tráfico TLS cifrado hacia una CDN genérica internacional;
     no puede ver el dominio del canal o película ni inyectar paquetes TCP RST mediante DPI.

3. **Flujo Modo Fluido protegido en webOS:**
   - En `index.js`, `resolveStream` pre-resuelve la IP por DoH antes de registrar la ruta.
   - FFmpeg lee exclusivamente desde el proxy local en `127.0.0.1`, evitando problemas
     de certificados o resolución DNS en el binario estático de la TV y entregando
     MP4 fragmentado limpio al elemento `<video>`.

4. **Verificación de permisos ejecutables:**
   - El binario `ffmpeg` conserva modo `0755` dentro del paquete IPK (`tools/fix_ipk_modes.py`).

---

## 3. Protocolo de comprobación obligatorio antes de entregar

Antes de entregar cualquier cambio que afecte la app, comprobar:

1. `node --check` de todos los archivos JavaScript modificados.
2. `node scratch/verify_agents_rule.js` (verificación automática de componentes).
3. Que el modo fluido siga enviando `forceRelay` y llame `resolveSmooth`.
4. Que el servicio siga registrando `resolveSmooth` y llame `relay.register`.
5. Que `proxy.js` mantenga la resolución previa `resolveHostIp` y el SNI camuflado `cachefly.net`.
6. Que `dnsx.js` conserve el pool multirresolutor DoH en paralelo.
7. Que el binario `ffmpeg` conserve modo `0755` dentro de la IPK construida.

Si una tarea visual requiere tocar alguna de estas rutas o módulos protegidos,
detenerse y pedir autorización explícita al usuario antes de hacerlo.
