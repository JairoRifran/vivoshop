import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Condiciones del Servicio',
  description:
    'Qué es VivoShop, qué hace y qué no, y las reglas para comprar y vender en la plataforma.',
};

const ACTUALIZADO = '2 de septiembre de 2026';

/**
 * Las Condiciones del Servicio.
 *
 * Igual que la política de privacidad: describe lo que el sistema hace, no lo
 * que sería lindo que hiciera.
 *
 * El punto más delicado está en la sección 5, y es deliberado que esté escrito
 * tan claro: **VivoShop no retiene el dinero hasta la entrega.** Se verificó
 * contra la API de Mercado Pago en M04.1 que la captura diferida no está
 * disponible en Uruguay. Prometer "compra protegida" sobre un mecanismo que no
 * existe sería mentirle a la persona justo en el momento en que más está
 * confiando.
 */
export default function TerminosPage() {
  return (
    <article>
      <h1 className="mb-2 text-[30px] font-extrabold tracking-tight text-ink">
        Condiciones del Servicio
      </h1>
      <p className="text-[13px] text-subtle">Última actualización: {ACTUALIZADO}</p>

      <p className="mt-8">
        Estas condiciones son el acuerdo entre vos y VivoShop. Al crear una cuenta o usar la
        plataforma, las aceptás. Si no estás de acuerdo con alguna, no uses el servicio.
      </p>

      <h2>1. Qué es VivoShop</h2>
      <p>
        VivoShop es una plataforma donde tiendas uruguayas transmiten en vivo y venden durante la
        transmisión. Es operada por <strong>Jairo Rifrán</strong>, con domicilio en Montevideo,
        Uruguay.
      </p>
      <p>
        <strong>VivoShop no vende nada.</strong> Somos el lugar donde se encuentran quien vende y
        quien compra. El contrato de compraventa se celebra{' '}
        <strong>entre el comprador y el vendedor</strong>, y no con nosotros. Nosotros ponemos la
        plataforma, el video y el circuito de pago.
      </p>

      <h2>2. Tu cuenta</h2>
      <ul>
        <li>Tenés que ser mayor de 18 años.</li>
        <li>Los datos que cargues tienen que ser verdaderos y estar al día.</li>
        <li>
          Sos responsable de lo que pase con tu cuenta. Si creés que alguien entró, cambiá la
          contraseña: eso cierra todas las sesiones abiertas.
        </li>
        <li>Una sola cuenta sirve para comprar y para vender.</li>
        <li>
          Podemos suspender una cuenta que incumpla estas condiciones o que use la plataforma para
          defraudar a otras personas.
        </li>
      </ul>

      <h2>3. Si comprás</h2>
      <p>
        Cuando confirmás un pedido, el stock queda reservado a tu nombre por un tiempo limitado. Si
        el pago no se completa, la reserva vence y el producto vuelve a estar disponible.
      </p>
      <p>
        El precio que ves incluye impuestos. El costo de envío, si corresponde, se muestra por
        separado antes de que confirmes.
      </p>
      <p>
        <strong>Quien te vende es la tienda, no VivoShop.</strong> El producto, su descripción, su
        calidad, el plazo de entrega y la garantía son responsabilidad del vendedor.
      </p>

      <h3>Tus derechos como consumidor</h3>
      <p>
        Como la compra se hace a distancia, la <strong>Ley N.º 17.250</strong> te da derecho a
        arrepentirte dentro de los <strong>cinco días</strong> de recibido el producto, sin tener
        que dar explicaciones y sin costo. Ese derecho es tuyo por ley y nada de lo que diga este
        documento lo limita.
      </p>

      <h2>4. Si vendés</h2>
      <ul>
        <li>
          Respondés por todo lo que vendés: que exista, que sea como lo describís, que sea legal y
          que llegue.
        </li>
        <li>
          Respondés por tus <strong>obligaciones tributarias</strong>. VivoShop no retiene ni paga
          impuestos por vos.
        </li>
        <li>
          Necesitás conectar tu propia cuenta de Mercado Pago para cobrar. El dinero de tus ventas
          entra ahí.
        </li>
        <li>Tenés que cumplir con la Ley N.º 17.250 frente a quien te compra.</li>
        <li>Las fotos y descripciones que subas tienen que ser tuyas o tener permiso de uso.</li>
      </ul>

      <h3>Comisión</h3>
      <p>
        VivoShop cobra una comisión sobre cada venta concretada. La comisión estándar es del{' '}
        <strong>3 %</strong> del total. Puede haber acuerdos particulares o promociones de
        lanzamiento con una comisión menor o sin comisión; en todos los casos, la comisión aplicada
        se muestra en el detalle de cada venta antes y después de que ocurra.
      </p>

      <h2>5. Pagos: lo que hacemos y lo que no</h2>
      <p>
        Los cobros los procesa <strong>Mercado Pago</strong>. Los datos de tu tarjeta nunca pasan por
        nuestros servidores.
      </p>
      <p>
        <strong>VivoShop no custodia el dinero de nadie.</strong> No tenemos billetera, ni cuenta de
        garantía, ni retenemos fondos. El pago va del comprador a la cuenta de Mercado Pago del
        vendedor, y de ahí se descuenta nuestra comisión.
      </p>

      <h3>No hay retención hasta la entrega, y conviene que lo sepas</h3>
      <p>
        En otras plataformas el dinero queda retenido hasta que el producto llega.{' '}
        <strong>Acá no funciona así</strong>, y no es una decisión nuestra: verificamos contra la
        API de Mercado Pago que la retención de fondos hasta la entrega no está disponible en
        Uruguay.
      </p>
      <p>Lo que sí existe:</p>
      <ul>
        <li>
          <strong>Devoluciones.</strong> Un pago puede devolverse, total o parcialmente, dentro de
          los plazos de Mercado Pago.
        </li>
        <li>
          <strong>Reclamos.</strong> Podés abrir un reclamo desde el detalle del pedido y nosotros
          intervenimos entre vos y la tienda.
        </li>
      </ul>
      <p>
        Preferimos decirte esto de frente antes de que compres, en vez de prometerte una protección
        que no podríamos cumplir.
      </p>

      <h2>6. Los vivos y el chat</h2>
      <p>
        Lo que escribís en el chat de una transmisión es público y queda guardado. El vendedor puede
        moderar el chat de su vivo, y nosotros podemos eliminar contenido que viole estas
        condiciones.
      </p>
      <p>
        El contenido de una transmisión es responsabilidad de la tienda que transmite. Si ves algo
        que no corresponde, escribinos.
      </p>

      <h2>7. Lo que no se puede hacer</h2>
      <ul>
        <li>
          Vender cosas prohibidas por la ley uruguaya: armas, drogas, medicamentos, fauna, productos
          falsificados, documentos, datos personales de terceros.
        </li>
        <li>Publicar contenido violento, sexual, discriminatorio o que acose a alguien.</li>
        <li>Usurpar la identidad de otra persona o de otra tienda.</li>
        <li>Usar la plataforma para estafar, lavar dinero o evadir impuestos.</li>
        <li>
          Intentar vulnerar la seguridad del servicio, automatizar accesos o extraer datos de forma
          masiva.
        </li>
        <li>Cerrar la operación por fuera para esquivar la comisión, habiéndola iniciado acá.</li>
      </ul>

      <h2>8. Propiedad intelectual</h2>
      <p>
        La marca VivoShop, el sitio y su código son nuestros. Lo que vos subís —fotos, descripciones,
        transmisiones— sigue siendo tuyo; al publicarlo nos das permiso para mostrarlo dentro de la
        plataforma con el fin de que tu tienda funcione.
      </p>

      <h2>9. Responsabilidad</h2>
      <p>
        VivoShop se ofrece tal como está. Hacemos lo razonable para que funcione, pero no podemos
        garantizar que esté disponible sin interrupciones: dependemos de servicios de terceros y de
        la conexión de cada quien.
      </p>
      <p>
        <strong>No respondemos por el incumplimiento del vendedor ni del comprador</strong>, porque
        no somos parte de esa compraventa. Sí respondemos por nuestras propias obligaciones como
        plataforma.
      </p>
      <p>
        Nada de esta sección limita los derechos que la ley uruguaya te da como consumidor. Si algo
        acá se contradice con una norma de orden público, manda la norma.
      </p>

      <h2>10. Cambios</h2>
      <p>
        Podemos actualizar estas condiciones. Cuando el cambio sea importante, te avisamos por correo
        o dentro de la aplicación antes de que entre en vigencia. La fecha de arriba dice cuándo fue
        la última vez.
      </p>

      <h2>11. Ley aplicable</h2>
      <p>
        Se aplica la <strong>ley de la República Oriental del Uruguay</strong>. Cualquier
        controversia se somete a los tribunales de Montevideo, sin perjuicio del derecho del
        consumidor a reclamar ante el organismo que corresponda.
      </p>

      <h2>12. Contacto</h2>
      <p>
        <a href="mailto:hola@vivoshop.live">hola@vivoshop.live</a>
      </p>
      <p>
        Ver también la <Link href="/privacidad">Política de Privacidad</Link>.
      </p>
    </article>
  );
}
