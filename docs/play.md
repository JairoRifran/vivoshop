# Google Play — preparación de la ficha

Todo lo que se puede adelantar sin tener la cuenta de Play Console, junto con lo
que solo puede hacer el titular.

Estado: **app creada, paquete firmado y publicado en prueba interna. Falta la
ficha (capturas) para enviar a revisión.**

---

## 1. Qué tipo de app se va a publicar

Un **TWA** (Trusted Web Activity): una cáscara Android que abre `vivoshop.live`
a pantalla completa usando Chrome por debajo. No hay código nativo ni una
segunda base de código: lo que se publica es la PWA que ya existe.

Se descartó Capacitor y, obviamente, un rewrite nativo. VivoShop **es** una
aplicación web móvil; envolverla es la ruta que Google mismo documenta, y
cualquier cambio del sitio llega a la app publicada sin pasar por una revisión.

### La PWA ya cumple los requisitos

| Requisito             | Estado                   |
| --------------------- | ------------------------ |
| `display: standalone` | ✅                       |
| Íconos 192 y 512      | ✅                       |
| Ícono `maskable`      | ✅                       |
| Service worker        | ✅ `/sw.js` responde 200 |
| HTTPS                 | ✅                       |
| `start_url` válida    | ✅ `/`                   |

## 2. Los cobros siguen en Mercado Pago, y eso está permitido

La política de pagos de Google Play **exige** Google Play Billing para bienes y
contenidos digitales, y ahí se lleva entre 15 % y 30 %.

VivoShop vende **bienes físicos** —ropa, artículos—, y para eso Play permite
expresamente un procesador externo. Mercado Pago sigue tal cual y Google no toca
la comisión.

Conviene no perder esto de vista si algún día se venden cosas digitales: la
regla cambia por completo.

## 3. Digital Asset Links

Es lo que permite que la app abra **sin la barra del navegador arriba**. Sin
este archivo la app funciona igual, pero muestra la URL y deja de parecer una
aplicación.

Implementado como ruta en `apps/web/src/app/api/assetlinks/route.ts`, con una
reescritura desde `/.well-known/assetlinks.json`.

**Resuelto el 4 de septiembre de 2026.** Devuelve 200 y la app instalada desde
Play abre sin barra del navegador — verificado en un teléfono real.

```
ANDROID_PACKAGE_NAME        live.vivoshop.app
ANDROID_SHA256_FINGERPRINT  17:5B:5C:48:FD:F2:31:89:44:8D:5F:F1:8B:07:2A:FE:
                            F1:62:80:86:85:B7:F3:16:4B:6A:3D:E7:F2:A8:15:05
```

Cargadas en Vercel como **Config**, no como Secret: ninguna de las dos es
secreta —la huella se publica para que Chrome la lea— y marcarlas como secreto
las volvería ilegibles sin ganar nada. **Sí hace falta un redespliegue en
Vercel**: las variables se inyectan al desplegar, no en caliente.

> **El error clásico de este archivo, confirmado en la práctica.** Play muestra
> **dos** huellas y hay que usar la correcta:
>
> | En Play Console                  | Huella         | ¿Sirve? |
> | -------------------------------- | -------------- | ------- |
> | _Certificado de clave de subida_ | `50:D1:3D:93…` | ❌      |
> | _Digital Asset Links JSON_       | `17:5B:5C:48…` | ✅      |
>
> La de subida es la del almacén local que genera PWABuilder — y el zip trae un
> `assetlinks.json` ya armado **con esa huella**, que es justo la trampa. La que
> vale es la del certificado que genera Google, y Play la entrega dentro de un
> fragmento JSON listo para copiar.
>
> Ojo con la ruta: la sección **ya no está** en _Configuración → Integridad de la
> app_. Google la movió a **Firma de aplicaciones** (`/keymanagement`).
>
> Corolario práctico: el APK del zip **nunca** va a abrir sin barra, porque está
> firmado con la clave local. Para probarlo hay que instalar desde Play, que es
> quien firma con la clave buena.

## 4. Textos de la ficha

### La posición: "ventas en vivo", no "tiendas"

Los primeros textos decían _"tiendas uruguayas"_, y estaba mal apuntado.
Describe comercios formales y deja afuera al público real de este producto: la
persona que **ya vende transmitiendo** en una red social y anota los pedidos en
los comentarios.

Esa conducta tiene un nombre propio en la región —**ventas en vivo**— y es lo
que la gente busca. Los textos apuntan a la conducta, no a un tipo de comercio,
y dicen explícitamente que no hace falta tener local ni empresa.

Los textos **no nombran a ninguna plataforma competidora**. Play desaconseja
referenciar otras marcas, y además describir la conducta —"anotar pedidos en los
comentarios"— pega más fuerte que nombrarla.

### Nombre de la app (máx. 30)

```
VivoShop: ventas en vivo
```

24 caracteres. "Ventas en vivo" cubre las dos puntas: quien busca comprar y
quien busca vender.

### Descripción breve (máx. 80)

```
Comprá en el vivo. Y si vendés en vivo, cobrá sin anotar comentarios.
```

69 caracteres.

### Descripción completa

```
VivoShop es la app de las ventas en vivo.

Si ya vendés transmitiendo --mostrando lo que tenés, respondiendo preguntas,
anotando quién se lleva qué-- sabés cómo termina: una lista de comentarios,
mensajes por privado para pasar el alias, y transferencias que hay que ir
cruzando a mano.

Acá el vivo y el cobro son la misma cosa.

PARA QUIEN VENDE

• Transmití desde el celular, sin equipo ni programa aparte.
• Mostrá el producto y que se pueda comprar en ese mismo momento.
• Cobrá con tu propia cuenta de Mercado Pago. La plata entra ahí.
• Se acabó anotar pedidos en los comentarios: cada compra queda registrada.
• No hace falta tener local ni empresa. Si vendés, podés vender acá.
• Comisión del 3% sobre cada venta concretada. Nada más.

PARA QUIEN COMPRA

• Mirá vivos y comprá sin salir de la transmisión.
• Preguntá por talle, color o envío y que te contesten en el momento.
• Seguí a quien te interesa y recibí un aviso cuando sale en vivo.
• Mirá el estado de tus pedidos en un solo lugar.

PAGOS

Los cobros los procesa Mercado Pago. Los datos de tu tarjeta nunca pasan por
los servidores de VivoShop.

Importante: VivoShop no retiene el dinero hasta la entrega. Preferimos decirlo
antes de que compres en vez de prometer una protección que no podríamos
cumplir. Lo que sí existe son devoluciones dentro de los plazos de Mercado Pago
y reclamos con intervención nuestra.

HECHO EN URUGUAY

Precios en pesos, envíos dentro del país y atención en español.

Política de privacidad: https://vivoshop.live/privacidad
Condiciones del servicio: https://vivoshop.live/terminos
```

## 5. Formulario de Seguridad de los Datos

Play obliga a declararlo y **compara lo declarado con el comportamiento real de
la app**. Estas respuestas salen del inventario de `docs/m10.md` §3.

### Preguntas generales

| Pregunta                                     | Respuesta                               |
| -------------------------------------------- | --------------------------------------- |
| ¿Los datos se cifran en tránsito?            | **Sí** — todo va por HTTPS              |
| ¿Se puede pedir la eliminación de los datos? | **Sí**                                  |
| URL de eliminación de cuenta                 | `https://vivoshop.live/eliminar-cuenta` |

### Qué se recolecta

“Compartido” en el vocabulario de Play significa **transferido a otra empresa u
organización**. Los proveedores que procesan por cuenta nuestra —Supabase,
Railway, Resend— no cuentan. **El vendedor sí**: es otro comerciante y recibe
tus datos de entrega.

| Tipo de dato             | Se recolecta |     Se comparte      | Obligatorio | Para qué                                |
| ------------------------ | :----------: | :------------------: | ----------- | --------------------------------------- |
| Nombre                   |      Sí      | **Sí** (al vendedor) | Sí          | Función de la app, gestión de la cuenta |
| Correo electrónico       |      Sí      |          No          | Sí          | Función de la app, gestión de la cuenta |
| Número de teléfono       |      Sí      | **Sí** (al vendedor) | Opcional    | Coordinar la entrega                    |
| Dirección física         |      Sí      | **Sí** (al vendedor) | Opcional    | Envío del pedido                        |
| ID de usuario            |      Sí      |          No          | Sí          | Función de la app                       |
| Historial de compras     |      Sí      | **Sí** (al vendedor) | Sí          | Función de la app                       |
| Fotos                    |      Sí      |          No          | Opcional    | Foto de perfil y de tienda              |
| Mensajes en la app       |      Sí      |          No          | Opcional    | El chat del vivo                        |
| Interacciones con la app |      Sí      |          No          | Opcional    | Analítica propia                        |
| Otros identificadores    |      Sí      |          No          | Opcional    | Enviar avisos al dispositivo            |

### Qué NO se recolecta, y conviene declararlo así

- **Información de pago.** Los datos de tarjeta van directo a Mercado Pago.
- **Ubicación precisa o aproximada.** No se pide permiso de ubicación.
- **Contactos, calendario, archivos, SMS.**
- **Datos de salud, condición física, orientación o creencias.**
- **Historial de navegación o búsqueda fuera de la app.**

### Un dato que sí merece atención

`identity_verifications` guarda **tipo y número de documento** cuando alguien
verifica su identidad. Hoy ese flujo no está expuesto en la aplicación, así que
**no se declara como recolectado**. El día que se active, esta tabla cambia
antes de publicar la versión: declarar de menos es lo que Play sanciona.

## 6. Assets gráficos

Generados y versionados en `assets/play/`:

| Archivo                          | Medida    | Notas                                                           |
| -------------------------------- | --------- | --------------------------------------------------------------- |
| `icono-tienda-512.png`           | 512×512   | A sangre, sin esquinas redondeadas: Play pone su propia máscara |
| `grafico-destacado-1024x500.png` | 1024×500  | Sin transparencia, contenido centrado porque Play lo recorta    |
| `capturas/*.png`                 | 1170×2532 | Cuatro, a 3× de densidad                                        |

Se regeneran con:

```bash
node scripts/generar-assets-play.mjs
node scripts/capturar-pantallas.mjs https://vivoshop.live
```

### Las capturas todavía NO sirven para publicar

Son técnicamente correctas y se ven nítidas, pero el **contenido** no está listo:

- La de inicio abre con **“Nadie está transmitiendo”**. Es el peor primer cuadro
  posible para una ficha: dice que la app está vacía.
- Hay **dos tiendas de prueba duplicadas**, “Jairo Store” y “jairo Store”.
- Los productos muestran **degradados de relleno** en vez de fotos reales.
- Aparece la **foto de una persona real** como logo de tienda. Es del titular y
  es su decisión, pero publicar una ficha en Play es publicar esa cara.

Hay que volver a sacarlas cuando exista una tienda con productos fotografiados y
al menos un vivo activo. Con el script es un comando.

## 7. Clasificación de contenido

El cuestionario IARC se completa en la consola. Lo que hay que declarar con
honestidad:

- **Los usuarios interactúan entre sí** — hay chat en vivo.
- **Los usuarios pueden compartir contenido** — las tiendas transmiten video.
- **Hay compras** de bienes físicos.
- No hay violencia, sexo, drogas, apuestas ni lenguaje ofensivo en el producto.

Con eso la clasificación suele quedar baja, pero con la etiqueta de interacción
entre usuarios. Las Condiciones del Servicio ya piden 18 años.

## 8. Lo que solo puede hacer el titular

1. **Crear la cuenta de Play Console.** US$ 25, pago único. No creo cuentas ni
   acepto términos en nombre de nadie.
2. **Elegir tipo de cuenta.** Si es **personal**, Google exige un test cerrado
   con al menos **12 testers durante 14 días corridos** antes de habilitar
   producción. Las cuentas de **organización** (con D-U-N-S) están exentas. Esto
   define el calendario mucho más que el trabajo técnico — conviene confirmarlo
   al registrarse, porque Google cambia la regla seguido.
3. **Generar el paquete firmado.** Acá no hay JDK ni Android SDK instalados, así
   que la vía sin instalar nada es **PWABuilder**, que compila en la nube desde
   la URL del manifest y entrega el `.aab` y el almacén de claves.
4. **Guardar el almacén de claves.** Si se pierde, no se puede volver a publicar
   una actualización de esa app nunca más.
5. **Subir**, completar la ficha con los textos de §4 y el formulario de §5.

## 8.5. La cuenta de demostración para la revisión

Google **exige** una cuenta activa con credenciales para poder entrar a la app y
revisarla. Va en la ficha, sección **App access → All or some functionality is
restricted**.

Creada en **producción** el 3 de septiembre de 2026, por el flujo de registro
real (`POST /auth/register`), no inyectada en la base:

```
Email:       demo@vivoshop.live
Contraseña:  VivoDemo2026!
Rol:         buyer
```

Verificada de punta a punta: `POST /auth/login` → 200, `GET /auth/me` → 200. Es
el correo de nuestro propio dominio, así que se distingue de un usuario real de
un vistazo, y **no necesita buzón** —el ingreso no manda correo de confirmación—,
aunque `hola@` sí existe si alguna vez hiciera falta recuperar la contraseña.

**No se le fabricaron pedidos pagados.** Meter registros de compra falsos en la
base de producción —con la contabilidad y Mercado Pago detrás— es exactamente lo
que este proyecto evita desde M03. El revisor entra, ve el catálogo y las tiendas
reales que ya existen, y navega; con eso alcanza. Si Google pidiera ver el
recorrido de compra completo, se le arma un pedido de prueba en ese momento y se
cancela después, en vez de dejar basura permanente.

## 9. Lo hecho y lo que falta

Hecho el 4 de septiembre de 2026:

- Cuenta de desarrollador verificada (identidad y teléfono).
- App creada: `live.vivoshop.app`, es-419, gratuita.
- Ficha con textos, ícono y gráfico destacado.
- **Las diez declaraciones de contenido**, incluida Seguridad de los datos con
  13 tipos de dato y la clasificación IARC (12+).
- Paquete firmado con PWABuilder y publicado en **prueba interna**.
- `assetlinks.json` en 200 y **verificado en un teléfono: sin barra**.

Falta:

- **Capturas de pantalla** — el único bloqueo, y depende de tener contenido real.
- Prueba cerrada con testers, que Google exige antes de habilitar producción.
- Enviar la ficha a revisión.

## 10. Deuda que Play vuelve más urgente

- **Contenido real** antes de sacar las capturas (§6): la de inicio abre con
  "Nadie está transmitiendo", los productos son degradados de relleno, y hay una
  tienda de prueba duplicada.
- **El logo de la pantalla de consentimiento de Google** sigue sin subirse, para
  no disparar una revisión que limite a 100 usuarios.
