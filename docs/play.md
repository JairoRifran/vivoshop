# Google Play — preparación de la ficha

Todo lo que se puede adelantar sin tener la cuenta de Play Console, junto con lo
que solo puede hacer el titular.

Estado: **preparado, sin publicar.**

---

## 1. Qué tipo de app se va a publicar

Un **TWA** (Trusted Web Activity): una cáscara Android que abre `vivoshop.live`
a pantalla completa usando Chrome por debajo. No hay código nativo ni una
segunda base de código: lo que se publica es la PWA que ya existe.

Se descartó Capacitor y, obviamente, un rewrite nativo. VivoShop **es** una
aplicación web móvil; envolverla es la ruta que Google mismo documenta, y
cualquier cambio del sitio llega a la app publicada sin pasar por una revisión.

### La PWA ya cumple los requisitos

| Requisito | Estado |
| --- | --- |
| `display: standalone` | ✅ |
| Íconos 192 y 512 | ✅ |
| Ícono `maskable` | ✅ |
| Service worker | ✅ `/sw.js` responde 200 |
| HTTPS | ✅ |
| `start_url` válida | ✅ `/` |

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

Ya está implementado como ruta, en `apps/web/src/app/api/assetlinks/route.ts`,
con una reescritura desde `/.well-known/assetlinks.json`. Devuelve **404 a
propósito** hasta que existan dos variables de entorno:

```
ANDROID_PACKAGE_NAME        p. ej. live.vivoshop.app
ANDROID_SHA256_FINGERPRINT  la huella SHA-256 del certificado de firma
```

Se cargan en Vercel y la ruta empieza a responder sola. **No hace falta tocar
código ni volver a desplegar el repositorio.**

> **El error clásico de este archivo.** Si se publica con *Play App Signing*
> —lo habitual y lo recomendado—, la huella que vale es la del certificado que
> **genera Google**, no la del almacén local. Está en Play Console → Configuración
> → Integridad de la app. Poner la del almacén local hace que la barra del
> navegador siga apareciendo, sin ningún mensaje de error que lo explique.

## 4. Textos de la ficha

### Nombre de la app (máx. 30)

```
VivoShop: comprá en vivo
```

### Descripción breve (máx. 80)

```
Mirá vivos de tiendas uruguayas y comprá sin salir de la transmisión.
```

### Descripción completa

```
VivoShop es comercio en vivo hecho en Uruguay.

Las tiendas transmiten desde el celular, muestran lo que tienen y responden en
el momento. Vos mirás, preguntás en el chat y comprás sin salir del vivo.

QUÉ PODÉS HACER

• Mirar transmisiones en vivo de tiendas uruguayas.
• Preguntar por talles, colores o envíos y que te contesten ahí mismo.
• Comprar durante la transmisión, sin cambiar de aplicación.
• Seguir a tus tiendas y recibir un aviso cuando salen en vivo.
• Ver el estado de tus pedidos en un solo lugar.

SI VENDÉS

• Creá tu tienda gratis y transmití desde el celular.
• Mostrá tus productos durante el vivo y vendé en el momento.
• Cobrá con tu propia cuenta de Mercado Pago.
• Comisión del 3% sobre cada venta concretada.

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

| Pregunta | Respuesta |
| --- | --- |
| ¿Los datos se cifran en tránsito? | **Sí** — todo va por HTTPS |
| ¿Se puede pedir la eliminación de los datos? | **Sí** |
| URL de eliminación de cuenta | `https://vivoshop.live/eliminar-cuenta` |

### Qué se recolecta

“Compartido” en el vocabulario de Play significa **transferido a otra empresa u
organización**. Los proveedores que procesan por cuenta nuestra —Supabase,
Railway, Resend— no cuentan. **El vendedor sí**: es otro comerciante y recibe
tus datos de entrega.

| Tipo de dato | Se recolecta | Se comparte | Obligatorio | Para qué |
| --- | :---: | :---: | --- | --- |
| Nombre | Sí | **Sí** (al vendedor) | Sí | Función de la app, gestión de la cuenta |
| Correo electrónico | Sí | No | Sí | Función de la app, gestión de la cuenta |
| Número de teléfono | Sí | **Sí** (al vendedor) | Opcional | Coordinar la entrega |
| Dirección física | Sí | **Sí** (al vendedor) | Opcional | Envío del pedido |
| ID de usuario | Sí | No | Sí | Función de la app |
| Historial de compras | Sí | **Sí** (al vendedor) | Sí | Función de la app |
| Fotos | Sí | No | Opcional | Foto de perfil y de tienda |
| Mensajes en la app | Sí | No | Opcional | El chat del vivo |
| Interacciones con la app | Sí | No | Opcional | Analítica propia |
| Otros identificadores | Sí | No | Opcional | Enviar avisos al dispositivo |

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

| Archivo | Medida | Notas |
| --- | --- | --- |
| `icono-tienda-512.png` | 512×512 | A sangre, sin esquinas redondeadas: Play pone su propia máscara |
| `grafico-destacado-1024x500.png` | 1024×500 | Sin transparencia, contenido centrado porque Play lo recorta |
| `capturas/*.png` | 1170×2532 | Cuatro, a 3× de densidad |

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

## 9. Después de publicar

- Cargar `ANDROID_PACKAGE_NAME` y `ANDROID_SHA256_FINGERPRINT` en Vercel.
- Comprobar que `https://vivoshop.live/.well-known/assetlinks.json` devuelva 200.
- Abrir la app instalada y verificar que **no** aparezca la barra del navegador.

## 10. Deuda que Play vuelve más urgente

- **Borrar la cuenta desde la aplicación.** Hoy `/eliminar-cuenta` explica un
  procedimiento manual por correo. Cumple el requisito de Play —que pide una URL
  pública— pero Google prefiere el borrado dentro de la app, y la Política de
  Privacidad promete un derecho que hoy se ejerce escribiendo un mail.
- **Contenido real** antes de sacar las capturas (§6).
- **La tienda duplicada** de prueba, que ensucia cualquier captura.
