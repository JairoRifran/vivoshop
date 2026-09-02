import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Política de Privacidad',
  description:
    'Qué datos guarda VivoShop, para qué, con quién se comparten y cómo pedir que se borren.',
};

const ACTUALIZADO = '2 de septiembre de 2026';

/**
 * La Política de Privacidad.
 *
 * Existe por una obligación concreta —Google no publica una app de OAuth sin un
 * enlace público a esta página— pero está escrita para que alguien la entienda,
 * no para cumplir un trámite.
 *
 * **Cada afirmación describe lo que el código hace de verdad.** Se escribió
 * recorriendo el esquema de la base tabla por tabla. Una política que promete
 * más de lo que el sistema cumple es peor que no tener ninguna: es una
 * declaración falsa sobre datos de otras personas.
 *
 * Si el sistema cambia —una tabla nueva, un proveedor nuevo, un dato más—, esta
 * página cambia en el mismo commit.
 */
export default function PrivacidadPage() {
  return (
    <article>
      <h1 className="mb-2 text-[30px] font-extrabold tracking-tight text-ink">
        Política de Privacidad
      </h1>
      <p className="text-[13px] text-subtle">Última actualización: {ACTUALIZADO}</p>

      <p className="mt-8">
        Esta política explica qué datos personales recoge VivoShop, para qué los usa, con quién los
        comparte y cómo podés pedir que los borremos. Está escrita en criollo a propósito: si algo
        acá no se entiende, es un problema nuestro. Escribinos y lo corregimos.
      </p>

      <h2>1. Quién es responsable</h2>
      <p>
        VivoShop es operado por <strong>Jairo Rifrán</strong>, con domicilio en Montevideo,
        Uruguay. Para cualquier tema de datos personales, incluido ejercer los derechos de la
        sección 7:{' '}
        <a href="mailto:hola@vivoshop.live">hola@vivoshop.live</a>.
      </p>
      <p>
        Nos regimos por la <strong>Ley N.º 18.331 de Protección de Datos Personales</strong> y su
        decreto reglamentario, y por la <strong>Ley N.º 17.250 de Relaciones de Consumo</strong>.
      </p>

      <h2>2. Qué datos guardamos</h2>

      <h3>Tu cuenta</h3>
      <p>
        Nombre, correo electrónico y, si los cargás, teléfono, foto de perfil y una descripción
        breve. El correo es tu identidad dentro de VivoShop.
      </p>
      <p>
        Si te registrás con contraseña, <strong>no guardamos la contraseña</strong>: guardamos un
        resumen criptográfico (<em>scrypt</em>) del que no se puede volver atrás. Lo mismo con los
        enlaces de recuperación: en la base queda la huella del enlace, no el enlace.
      </p>

      <h3>Si entrás con Google</h3>
      <p>
        Recibimos de Google únicamente <strong>tu correo, tu nombre, tu foto de perfil</strong> y un
        identificador que Google usa para reconocerte. Nada más.
      </p>
      <p>
        <strong>No pedimos ni tenemos acceso a tu Gmail, tus contactos, tu Drive, tu calendario ni
        ningún otro servicio de Google.</strong> Los permisos que solicitamos se llaman{' '}
        <code>openid</code>, <code>email</code> y <code>profile</code>, y son los mínimos que
        existen para saber quién sos.
      </p>

      <h3>Cuando comprás</h3>
      <p>
        Lo que compraste, cuándo, a qué tienda y por cuánto. Si el envío lo requiere, también la
        dirección de entrega: nombre de quien recibe, teléfono, departamento, localidad, calle,
        código postal y las notas que dejes.
      </p>

      <h3>Pagos</h3>
      <p>
        <strong>Los datos de tu tarjeta nunca pasan por nuestros servidores.</strong> El cobro lo
        procesa Mercado Pago en su propia plataforma. De vuelta recibimos el monto, el estado del
        pago y un identificador de la operación — nunca el número de tarjeta, su vencimiento ni su
        código de seguridad.
      </p>

      <h3>Los vivos y el chat</h3>
      <p>
        Los mensajes que escribís en el chat de una transmisión quedan guardados junto con tu
        nombre y tu foto. <strong>Son públicos</strong>: los ve cualquiera que esté mirando ese
        vivo, y quedan asociados a esa transmisión después de que termina.
      </p>

      <h3>Avisos en el celular</h3>
      <p>
        Si aceptás recibir avisos cuando una tienda sale en vivo, guardamos la dirección técnica que
        tu navegador nos da para poder enviártelos, junto con sus claves de cifrado y el navegador
        que usaste. Esa dirección no nos permite hacer nada más que mandarte ese aviso, y se borra
        cuando apagás los avisos.
      </p>

      <h3>Verificación de identidad</h3>
      <p>
        Si en algún momento verificás tu identidad o la de tu tienda, guardamos tu nombre completo,
        el tipo y número de tu documento, tu teléfono y tu correo. Estos datos{' '}
        <strong>no se muestran nunca a otras personas</strong>: solo se usan para la verificación y
        para cumplir obligaciones legales.
      </p>

      <h3>Uso de la aplicación</h3>
      <p>
        Registramos eventos de uso —qué pantallas se abren, qué acciones se completan— para entender
        qué funciona y qué no.
      </p>
      <p>
        <strong>No usamos rastreadores de terceros.</strong> No hay Google Analytics, ni píxel de
        Meta, ni ninguna otra herramienta externa de medición. Esos datos quedan en nuestra propia
        base y no se venden ni se comparten con nadie.
      </p>

      <h3>Cookies</h3>
      <p>
        Usamos <strong>una sola cookie</strong>, llamada <code>vivo_session</code>, que sirve
        únicamente para mantenerte con la sesión iniciada. Es <em>httpOnly</em>, así que ni siquiera
        el código que corre en tu navegador puede leerla.
      </p>
      <p>
        No usamos cookies de publicidad ni de seguimiento. Por eso esta página no te pide aceptar
        nada: no hay nada opcional que aceptar.
      </p>

      <h2>3. Para qué usamos los datos</h2>
      <ul>
        <li>Para que puedas entrar a tu cuenta y sostener tu sesión.</li>
        <li>Para procesar tus compras y que el vendedor pueda entregarte lo que compraste.</li>
        <li>Para mostrarte tus pedidos y su estado.</li>
        <li>Para avisarte cuando una tienda que seguís sale en vivo, si lo pediste.</li>
        <li>Para mandarte correos de servicio: recuperar la contraseña, confirmar una compra.</li>
        <li>Para prevenir fraude y resolver reclamos entre compradores y vendedores.</li>
        <li>Para entender cómo se usa el producto y mejorarlo.</li>
      </ul>
      <p>
        <strong>No mandamos publicidad</strong> ni cedemos tus datos a terceros con fines
        comerciales.
      </p>

      <h2>4. Con quién se comparten</h2>

      <h3>Con el vendedor al que le comprás</h3>
      <p>
        Cuando hacés una compra, la tienda recibe tu nombre, tu contacto y —si hay envío— tu
        dirección de entrega. Es lo mínimo para que pueda entregarte el producto. El vendedor es
        responsable del uso que haga de esos datos.
      </p>

      <h3>Con proveedores que nos prestan servicio</h3>
      <p>
        VivoShop se apoya en servicios de terceros que procesan datos por cuenta nuestra. Cada uno
        recibe únicamente lo que necesita para su función:
      </p>
      <ul>
        <li>
          <strong>Mercado Pago</strong> — procesa los cobros. Tiene sus propias políticas y es quien
          maneja los datos de tu medio de pago.
        </li>
        <li>
          <strong>Supabase</strong> — la base de datos y el almacenamiento de imágenes.
        </li>
        <li>
          <strong>Railway</strong> — donde corre nuestro servidor, en Estados Unidos.
        </li>
        <li>
          <strong>Vercel</strong> — donde se sirve el sitio.
        </li>
        <li>
          <strong>Resend</strong> — envía los correos de servicio.
        </li>
        <li>
          <strong>LiveKit</strong> — transporta el video de las transmisiones en vivo.
        </li>
        <li>
          <strong>Google</strong> — solamente si elegís ingresar con Google.
        </li>
      </ul>

      <h3>Cuando la ley lo exige</h3>
      <p>
        Entregamos datos a una autoridad competente cuando una norma o una orden judicial nos
        obliga.
      </p>

      <h3>Transferencia fuera de Uruguay</h3>
      <p>
        Los proveedores de arriba están radicados fuera del país, así que tus datos se almacenan y
        procesan en el exterior, principalmente en Estados Unidos. Al usar VivoShop{' '}
        <strong>prestás tu consentimiento a esa transferencia internacional</strong>, en los
        términos del artículo 23 de la Ley N.º 18.331.
      </p>

      <h2>5. Cuánto tiempo los guardamos</h2>
      <ul>
        <li>
          <strong>Tu cuenta y tu perfil</strong>: mientras la cuenta exista.
        </li>
        <li>
          <strong>Pedidos y pagos</strong>: se conservan aunque borres la cuenta, porque son
          respaldo de una operación comercial y hay obligaciones contables y fiscales detrás.
        </li>
        <li>
          <strong>Enlaces de recuperación de contraseña</strong>: vencen a la hora y se usan una
          sola vez.
        </li>
        <li>
          <strong>Avisos</strong>: hasta que los apagues.
        </li>
        <li>
          <strong>Mensajes de chat</strong>: quedan asociados a la transmisión.
        </li>
      </ul>

      <h2>6. Cómo cuidamos los datos</h2>
      <ul>
        <li>Todo el tráfico viaja cifrado con TLS.</li>
        <li>
          Las contraseñas se guardan como resumen <em>scrypt</em>, no en texto.
        </li>
        <li>Las credenciales de cobro de los vendedores se guardan cifradas.</li>
        <li>
          Cambiar la contraseña <strong>cierra todas las sesiones abiertas</strong>, para que echar
          a un intruso funcione de verdad.
        </li>
        <li>La cookie de sesión es inaccesible para el código del navegador.</li>
      </ul>
      <p>
        Ningún sistema es infalible y sería deshonesto decir lo contrario. Si detectamos un incidente
        que afecte tus datos, te lo vamos a comunicar.
      </p>

      <h2>7. Tus derechos</h2>
      <p>
        La Ley N.º 18.331 te da derecho a <strong>acceder</strong> a tus datos, a{' '}
        <strong>rectificarlos</strong> si están mal, a pedir su <strong>supresión</strong> y a
        oponerte a determinados tratamientos.
      </p>
      <p>
        Para ejercerlos, escribinos a <a href="mailto:hola@vivoshop.live">hola@vivoshop.live</a>{' '}
        desde el correo de tu cuenta. Tenemos <strong>cinco días hábiles</strong> para responder un
        pedido de acceso y <strong>cinco días hábiles</strong> para corregir o borrar, según el
        artículo 14 y siguientes de la ley.
      </p>
      <p>
        Nombre, foto y descripción los podés cambiar vos mismo desde tu perfil, sin escribirnos.
      </p>
      <p>
        Si considerás que no te respondimos bien, podés reclamar ante la{' '}
        <strong>Unidad Reguladora y de Control de Datos Personales (URCDP)</strong>.
      </p>

      <h2>8. Menores de edad</h2>
      <p>
        VivoShop es para mayores de 18 años. No recogemos datos de menores a sabiendas. Si detectamos
        una cuenta de un menor, la damos de baja. Si sos madre, padre o tutor y creés que un menor a
        tu cargo creó una cuenta, escribinos y la borramos.
      </p>

      <h2>9. Cambios en esta política</h2>
      <p>
        Si la cambiamos, actualizamos la fecha de arriba. Cuando el cambio sea importante —un dato
        nuevo, un proveedor nuevo, un uso distinto— te avisamos por correo o dentro de la
        aplicación antes de que entre en vigencia.
      </p>

      <h2>10. Contacto</h2>
      <p>
        <a href="mailto:hola@vivoshop.live">hola@vivoshop.live</a>
      </p>
      <p>
        Ver también las <Link href="/terminos">Condiciones del Servicio</Link>.
      </p>
    </article>
  );
}
