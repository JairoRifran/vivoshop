import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Eliminar tu cuenta',
  description: 'Cómo pedir que borremos tu cuenta de VivoShop y qué se borra exactamente.',
};

/**
 * Cómo se borra una cuenta.
 *
 * Existe por dos motivos que coinciden. Google Play **exige** una URL pública
 * —accesible sin instalar la app— donde se explique cómo eliminar la cuenta,
 * para cualquier aplicación que permita registrarse. Y la Ley N.º 18.331 da
 * derecho a la supresión, que la Política de Privacidad ya promete.
 *
 * Hoy el borrado se hace **a mano, por correo**. Esta página lo dice así en vez
 * de sugerir un botón que no existe: es la deuda anotada en `docs/m10.md` §9, y
 * mientras no se resuelva, lo honesto es explicar el procedimiento real.
 *
 * La tabla de qué se borra y qué no también es deliberada. "Borramos todo" sería
 * mentira: los pedidos son respaldo de una operación comercial con obligaciones
 * contables detrás, y quedan.
 */
export default function EliminarCuentaPage() {
  return (
    <article>
      <h1 className="mb-2 text-[30px] font-extrabold tracking-tight text-ink">
        Eliminar tu cuenta
      </h1>
      <p className="text-[13px] text-subtle">VivoShop · vivoshop.live</p>

      <p className="mt-8">
        Podés pedir que borremos tu cuenta cuando quieras, sin dar explicaciones y sin costo.
      </p>

      <h2>Desde la aplicación</h2>
      <p>
        La forma más rápida: entrá a tu cuenta y andá a{' '}
        <Link href="/perfil/eliminar">Perfil → Eliminar cuenta</Link>. Se confirma escribiendo tu
        propio correo y se ejecuta en el momento.
      </p>

      <h2>Por correo, si preferís</h2>
      <p>
        Escribinos a <a href="mailto:hola@vivoshop.live">hola@vivoshop.live</a>{' '}
        <strong>desde la dirección de correo de tu cuenta</strong>, con el asunto{' '}
        <em>“Eliminar mi cuenta”</em>.
      </p>
      <p>
        Que el pedido venga de esa dirección es lo que nos permite confirmar que sos vos. No pedimos
        foto del documento ni ningún dato extra: sería pedirte más información para borrar
        información.
      </p>
      <p>
        Respondemos dentro de los <strong>cinco días hábiles</strong> que fija el artículo 15 de la
        Ley N.º 18.331.
      </p>

      <h2>Qué se borra</h2>
      <ul>
        <li>Tu nombre, tu correo, tu teléfono y tu descripción.</li>
        <li>Tu foto de perfil, incluido el archivo en el almacenamiento.</li>
        <li>Tu contraseña y cualquier enlace de recuperación pendiente.</li>
        <li>El vínculo con tu cuenta de Google, si habías entrado con ella.</li>
        <li>Las tiendas que seguís y tus preferencias de aviso.</li>
        <li>Las suscripciones a notificaciones de tus dispositivos.</li>
      </ul>

      <h2>Qué NO se borra, y por qué</h2>
      <p>
        Hay tres cosas que sobreviven, y preferimos decirlo acá antes de que las descubras
        después:
      </p>
      <ul>
        <li>
          <strong>Los pedidos y los pagos.</strong> Son el respaldo de una operación comercial entre
          vos y una tienda, con obligaciones contables y fiscales detrás. Quedan asociados a un
          identificador, ya sin tus datos personales de contacto.
        </li>
        <li>
          <strong>Los mensajes que escribiste en un chat en vivo.</strong> Se despersonalizan —dejan
          de mostrar tu nombre y tu foto— pero el texto queda, porque forma parte de una conversación
          pública en la que participaron otras personas.
        </li>
        <li>
          <strong>Tu tienda, si tenías.</strong> Deja de estar publicada y no se puede volver a
          abrir, pero el registro sobrevive: los pedidos históricos la referencian, y quien te
          compró tiene derecho a ver a quién le compró.
        </li>
      </ul>

      <h2>Si preferís no borrar todo</h2>
      <p>
        Podés cambiar tu nombre, tu foto y tu descripción vos mismo desde tu perfil, y apagar los
        avisos desde cada tienda que seguís. Para eso no hace falta escribirnos ni borrar nada.
      </p>

      <p className="mt-8 text-[13px] text-subtle">
        Ver también la <Link href="/privacidad">Política de Privacidad</Link> y las{' '}
        <Link href="/terminos">Condiciones del Servicio</Link>.
      </p>
    </article>
  );
}
