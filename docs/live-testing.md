# Probar el vivo de verdad

Cómo verificar la transmisión en vivo: qué se puede automatizar, qué hay que
probar a mano, y qué **no** se probó todavía.

## Lo primero: qué significa cada nivel de prueba

| Nivel | Cámara | Qué demuestra |
| --- | --- | --- |
| Suite automatizada (`pnpm test`, `pnpm test:e2e`) | **Falsa** (`--use-fake-device-for-media-stream`) | Que el circuito está conectado: permisos, `getUserMedia`, preview, controles, realtime, estados. |
| Verificación con LiveKit local (`docs` abajo) | **Falsa** | Que el SFU real recibe pistas reales de audio y video, y que un espectador anónimo las recibe. |
| Prueba física (este documento) | **Real** | Que funciona en un teléfono, con la mano, con la red de alguien. Nada más lo demuestra. |

> **Importante.** Todo lo automatizado en este repositorio usa **media falsa**.
> Ninguna prueba automatizada afirma que se haya usado una cámara física. Si
> alguien pregunta "¿probaron con un teléfono real?", la respuesta honesta está
> en la sección [Registro de pruebas físicas](#registro-de-pruebas-físicas).

---

## 1. Sin cuenta ni infraestructura: el proveedor `mock`

Es el modo por defecto. `pnpm install && pnpm dev` alcanza.

```bash
pnpm dev
```

Con `STREAMING_PROVIDER=mock`:

- La consola del vendedor **sí** abre la cámara local (`getUserMedia`). El
  preview es real; lo que no hay es a dónde publicarlo.
- El espectador ve el escenario simulado, rotulado como tal.
- Chat, corazones, espectadores, producto destacado y estados **funcionan
  completos**: el canal de realtime es independiente del video a propósito.

Sirve para desarrollar todo salvo la calidad de video.

---

## 2. Con video real: LiveKit local

No hace falta cuenta ni tarjeta.

### Instalar y arrancar el servidor

```bash
docker run --rm -p 7880:7880 -p 7881:7881 -p 50000-50100:50000-50100/udp livekit/livekit-server --dev
```

Sin Docker, descargar el binario de
[github.com/livekit/livekit/releases](https://github.com/livekit/livekit/releases)
y arrancarlo con un `livekit.yaml`:

```yaml
port: 7880
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 50100
  use_external_ip: false
keys:
  devkey: devsecret_at_least_32_characters_long_ok
```

```bash
livekit-server --config livekit.yaml
```

### Apuntar la API al servidor

En `.env`:

```
STREAMING_PROVIDER=livekit
LIVEKIT_URL=ws://127.0.0.1:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecret_at_least_32_characters_long_ok
```

`pnpm dev`. El arranque imprime `Streaming: livekit`. Si falta alguna de las
tres variables, la API **no arranca**: es preferible a descubrirlo cuando el
vendedor toca "Transmitir" delante de gente.

### LiveKit Cloud

Igual, cambiando las tres variables por las del proyecto:

```
LIVEKIT_URL=wss://<proyecto>.livekit.cloud
LIVEKIT_API_KEY=API...
LIVEKIT_API_SECRET=...
```

No hay ninguna otra diferencia en el código. `LIVEKIT_API_SECRET` **nunca** sale
del proceso de la API: los tokens se firman en el servidor, por participante,
con el permiso mínimo y con vencimiento.

---

## 3. Prueba física con dos dispositivos

Esto es lo único que demuestra que el producto funciona.

### Preparar

1. La computadora y el teléfono en la **misma red Wi-Fi**.
2. Averiguar la IP de la computadora (`ipconfig` / `ifconfig`), por ejemplo
   `192.168.1.40`.
3. En `.env`:
   ```
   WEB_ORIGIN=http://192.168.1.40:3000
   NEXT_PUBLIC_API_URL=http://192.168.1.40:4000
   LIVEKIT_URL=ws://192.168.1.40:7880
   ```
4. En `livekit.yaml`, `use_external_ip: false` está bien en LAN.

> **La cámara necesita contexto seguro.** El navegador solo entrega
> `getUserMedia` en `https://` o en `localhost`. Desde un teléfono, `http://` a
> una IP de LAN **no alcanza**. Dos salidas:
>
> - **ngrok / cloudflared** sobre el puerto 3000 y usar la URL `https`.
> - **Chrome en Android**: `chrome://flags` →
>   *Insecure origins treated as secure* → agregar `http://192.168.1.40:3000`.
>   Solo para pruebas.
>
> El espectador **no** necesita contexto seguro: solo mira.

### Recorrido del vendedor (teléfono)

| # | Paso | Qué tiene que pasar |
| --- | --- | --- |
| 1 | Entrar con `martina@vivo.uy` / `vivo1234` | Panel de vendedor |
| 2 | Vender → Transmitir → nuevo vivo con al menos un producto | Se abre la consola |
| 3 | Primera vez | El navegador pide cámara y micrófono |
| 4 | **Rechazar** el permiso | Aparece "Necesitamos permiso para usar la cámara" con instrucciones y botón Reintentar. **No** una excepción técnica |
| 5 | Aceptar y reintentar | Se ve la imagen de la cámara trasera, sin espejar |
| 6 | Botón de cambiar cámara | Pasa a la frontal, **espejada**; vuelve atrás sin espejo |
| 7 | Apagar cámara | La imagen desaparece, dice "Cámara apagada", el LED del teléfono se apaga |
| 8 | Silenciar micrófono | El botón queda marcado; el espectador deja de escuchar |
| 9 | Dejar el teléfono quieto 2 minutos | La pantalla **no** se apaga (Wake Lock) |
| 10 | Tocar un producto de la tira | Queda "En pantalla" |
| 11 | Caminar hasta perder señal | El estado dice "Conexión inestable" o "Se cortó la conexión… tu vivo sigue abierto". **No** dice "finalizado" |
| 12 | Volver a tener señal antes de 90 s | Vuelve a "En vivo" solo |
| 13 | Finalizar | Pide confirmación; una sola tocada **no** termina el vivo |

### Recorrido del comprador (otro teléfono, sin cuenta)

| # | Paso | Qué tiene que pasar |
| --- | --- | --- |
| 1 | Abrir el link del vivo | Se ve el video, **sin pedir cuenta** |
| 2 | Al entrar | Arranca **silenciado**, con "Tocá para activar el sonido" |
| 3 | Tocar la pantalla | Entra el audio |
| 4 | Mirar el contador | Sube al entrar y baja al salir, y coincide con la consola |
| 5 | Tocar el corazón varias veces | Suben corazones; el vendedor ve el total |
| 6 | Escribir un comentario | Manda a ingresar. Después de entrar, el comentario aparece **en los dos teléfonos** en menos de un segundo |
| 7 | Mandar 8 comentarios seguidos | Después de 5 aparece "Esperá N s". **No** un error técnico |
| 8 | Comprar el producto destacado | El vendedor ve el pedido y la facturación **al instante**. El resto de los espectadores ve, como mucho, "Alguien acaba de comprar <producto>" — **nunca** el nombre del comprador ni el monto |
| 9 | Compartir | Se abre la hoja nativa; si no hay, copia el link y avisa "Link copiado" |
| 10 | Cuando el vendedor finaliza | La pantalla pasa a "Esta transmisión terminó" sin recargar |

### Qué medir

- **Latencia**: mostrar un cronómetro en la cámara y fotografiar los dos
  teléfonos juntos. Con LiveKit local en LAN, esperar menos de 500 ms.
- **Reconexión**: modo avión 10 s. El vivo tiene que volver, no terminar.
- **Batería y calor**: 10 minutos transmitiendo. Anotar el consumo.

### Limitación conocida: segundo plano

Un navegador móvil **suspende la captura** cuando la pestaña deja de estar
visible. Si el vendedor cambia de app o bloquea el teléfono, la transmisión se
corta. Con el período de gracia el vivo aguanta 90 segundos y se recupera si
vuelve; después se cierra solo.

Es una limitación de la web, no un error de esta implementación, y **no se
resuelve en M02**. Resolverla requiere una app nativa; ese es un milestone
propio.

---

## 4. Verificación semiautomática contra LiveKit

Con el servidor LiveKit corriendo y la API en modo `livekit`, esto comprueba lo
que el SFU **realmente** recibió, en vez de lo que el navegador cree:

```bash
node -e "const {RoomServiceClient}=require('livekit-server-sdk');const c=new RoomServiceClient('http://127.0.0.1:7880','devkey','devsecret_at_least_32_characters_long_ok');c.listRooms().then(r=>console.log(r.map(x=>x.name)))"
```

Durante un vivo tiene que aparecer una sala `live_<id>`; al finalizar, la lista
queda vacía.

---

## Registro de pruebas físicas

| Fecha | Dispositivo emisor | Dispositivo espectador | Red | Resultado |
| --- | --- | --- | --- | --- |
| — | — | — | — | **NO EJECUTADA** |

**Estado actual: la prueba con cámara física NO se ejecutó.** El entorno donde
se desarrolló M02 no tiene cámara ni micrófono disponibles. Todo lo verificado
automáticamente usó `--use-fake-device-for-media-stream`.

Lo que **sí** está verificado contra infraestructura real (LiveKit server
1.13.5 local, navegador real, WebRTC real, media falsa):

- La sala se crea en el servidor al iniciar y se destruye al finalizar.
- El emisor publica audio + video **1280×720**, confirmado consultando al SFU.
- Un espectador **anónimo** se suscribe y recibe video.
- Los permisos del token: emisor `canPublish: true`, `canPublishData: false`,
  `roomAdmin: false`, `roomCreate: false`, `canUpdateOwnMetadata: false`;
  espectador `canPublish: false`, `canSubscribe: true`, el resto en `false`.

Al ejecutar la prueba física, agregar una fila arriba con el detalle real.
