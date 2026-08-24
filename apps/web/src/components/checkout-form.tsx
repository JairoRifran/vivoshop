'use client';

import type { DeliveryMethodConfig, PaymentMethodConfig, Region } from '@vivo/config';
import type { CheckoutPreviewDto, ProductDetailDto, StoreDetailDto, UserDto } from '@vivo/shared';
import { Button, SelectField, TextArea, TextInput, cn } from '@vivo/ui';
import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { placeOrder, previewCheckout } from '@/lib/actions/checkout';
import { IDLE } from '@/lib/actions/state';
import { money } from '@/lib/format';
import { CheckIcon, StoreIcon, TruckIcon } from './icons';

interface Props {
  product: ProductDetailDto;
  variantId: string;
  quantity: number;
  store: StoreDetailDto;
  user: UserDto;
  delivery: DeliveryMethodConfig[];
  payment: PaymentMethodConfig[];
  regions: Region[];
  initialPreview: CheckoutPreviewDto;
  liveSessionId: string | null;
  /**
   * Una clave por pantalla de checkout, emitida por el servidor.
   *
   * Emitida arriba y no derivada acá a proposito. Derivarla del contenido
   * —tienda, producto, variante, cantidad— parecia suficiente y no lo era: el
   * mismo comprador volviendo a comprar el mismo producto reusaba la clave y
   * la API le contestaba `IDEMPOTENCY_CONFLICT` porque el resto del pedido
   * habia cambiado. Una clave tiene que identificar *este intento*, no *esta
   * compra*, y solo el servidor puede emitir algo asi sin romper la
   * hidratacion.
   *
   * Sigue siendo comodidad, no proteccion: la garantia vive en la API.
   */
  idempotencyKey: string;
}

const DELIVERY_ICON = {
  shipping: TruckIcon,
  pickup: StoreIcon,
  seller_coordination: StoreIcon,
} as const;

/**
 * One-screen checkout.
 *
 * The brief sketched product → data → delivery → payment → confirmation as
 * five steps. Four of those are two or three fields each, and every step
 * boundary is a place to abandon, so they are collapsed into one scrollable
 * form with a persistent total and a single commit. The address block only
 * exists when the chosen method actually needs it, which is what removes the
 * bulk of the typing for pickup buyers.
 */
export function CheckoutForm({
  product,
  variantId,
  quantity,
  store,
  user,
  delivery,
  payment,
  regions,
  initialPreview,
  liveSessionId,
  idempotencyKey,
}: Props) {
  const [state, action, submitting] = useActionState(placeOrder, IDLE);

  // Guards the window between the tap and React marking the action pending.
  const submitGuard = useRef(false);
  useEffect(() => {
    if (!submitting) submitGuard.current = false;
  }, [submitting]);

  /**
   * Un checkout no puede fallar en silencio.
   *
   * El método por defecto es envío a domicilio, que exige dirección, y esos
   * campos quedan **debajo del pliegue**. El navegador bloquea el envío y
   * reporta el primer campo inválido donde esté: detrás de la barra fija o
   * fuera de pantalla. Desde el teléfono se ve como que el botón no hace nada.
   *
   * Devuelve true cuando el formulario está listo para enviarse. Si no, trae
   * el campo que falta a la vista y deja que el navegador lo señale.
   */
  const readyToSubmit = (form: HTMLFormElement): boolean => {
    if (form.checkValidity()) return true;

    const firstInvalid = form.querySelector<HTMLElement>(
      'input:invalid, select:invalid, textarea:invalid',
    );
    firstInvalid?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    form.reportValidity();
    return false;
  };

  const allowed = useMemo(
    () => delivery.filter((method) => store.deliveryMethodIds.includes(method.id)),
    [delivery, store.deliveryMethodIds],
  );

  const [deliveryId, setDeliveryId] = useState(allowed[0]?.id ?? '');
  const [paymentId, setPaymentId] = useState(payment[0]?.id ?? '');
  const [installments, setInstallments] = useState(1);
  const [regionCode, setRegionCode] = useState(regions[0]?.code ?? '');
  const [preview, setPreview] = useState(initialPreview);
  const [recalculating, startRecalculate] = useTransition();

  const method = allowed.find((candidate) => candidate.id === deliveryId) ?? allowed[0];
  const paymentMethod = payment.find((candidate) => candidate.id === paymentId) ?? payment[0];
  const requiresAddress = method?.requiresAddress ?? false;
  const region = regions.find((candidate) => candidate.code === regionCode);

  // The total is never guessed on the client: every change re-asks the API,
  // which runs the same domain pricing the order will use.
  useEffect(() => {
    if (!method) return;
    startRecalculate(async () => {
      const next = await previewCheckout({
        storeId: store.id,
        productId: product.id,
        variantId,
        quantity,
        deliveryMethodId: method.id,
        installments,
      });
      if (next) setPreview(next);
    });
  }, [method, installments, product.id, quantity, store.id, variantId]);

  const variant = product.variants.find((candidate) => candidate.id === variantId);

  return (
    <form action={action} className="flex flex-col gap-6 pb-40">
      <input type="hidden" name="storeId" value={store.id} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="productId" value={product.id} />
      <input type="hidden" name="variantId" value={variantId} />
      <input type="hidden" name="quantity" value={quantity} />
      <input type="hidden" name="deliveryMethodId" value={method?.id ?? ''} />
      <input type="hidden" name="paymentMethodId" value={paymentMethod?.id ?? ''} />
      <input type="hidden" name="installments" value={installments} />
      <input type="hidden" name="requiresAddress" value={String(requiresAddress)} />
      <input type="hidden" name="regionName" value={region?.name ?? ''} />
      <input type="hidden" name="liveSessionId" value={liveSessionId ?? ''} />
      <input type="hidden" name="returnTo" value={`/checkout?producto=${product.id}`} />

      {state.status === 'error' && state.message ? (
        <p role="alert" className="rounded-2xl bg-danger/8 px-4 py-3 text-sm font-semibold text-danger">
          {state.message}
        </p>
      ) : null}

      {/* --- What you are buying ------------------------------------------ */}
      <section className="flex items-center gap-3 rounded-3xl bg-surface p-3 shadow-card">
        <span className="size-18 shrink-0 overflow-hidden rounded-2xl bg-muted">
          {product.images[0] ? (
            <img src={product.images[0].url} alt="" className="size-full object-cover" />
          ) : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[15px] font-bold">{product.title}</span>
          {variant?.label ? (
            <span className="text-[13px] text-subtle">{variant.label}</span>
          ) : null}
          <span className="text-[13px] text-subtle">
            {quantity} {quantity === 1 ? 'unidad' : 'unidades'} · {store.name}
          </span>
        </span>
        <span className="shrink-0 text-[15px] font-extrabold">
          {money(preview.subtotalMinor, preview.currency)}
        </span>
      </section>

      {/* --- Delivery -------------------------------------------------------- */}
      <fieldset className="flex flex-col gap-3">
        <legend className="pb-2 text-[17px] font-extrabold tracking-tight">
          ¿Cómo lo recibís?
        </legend>
        <div className="flex flex-col gap-2">
          {allowed.map((option) => {
            const Icon = DELIVERY_ICON[option.kind];
            const selected = option.id === method?.id;
            return (
              <label
                key={option.id}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-2xl border bg-surface p-4 transition-colors',
                  selected ? 'border-ink ring-1 ring-ink' : 'border-line hover:bg-muted',
                )}
              >
                <input
                  type="radio"
                  name="deliveryChoice"
                  value={option.id}
                  checked={selected}
                  onChange={() => setDeliveryId(option.id)}
                  className="sr-only"
                />
                <Icon className="mt-0.5 size-5 shrink-0 text-subtle" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[15px] font-bold">{option.label}</span>
                    <span className="shrink-0 text-[15px] font-bold">
                      {option.flatFeeMinor === 0
                        ? 'Sin costo'
                        : money(option.flatFeeMinor, preview.currency)}
                    </span>
                  </span>
                  <span className="block text-[13px] leading-snug text-subtle">
                    {option.description}
                  </span>
                  <span className="block text-[12px] font-semibold text-subtle">
                    {option.estimate}
                  </span>
                </span>
                {selected ? <CheckIcon className="mt-0.5 size-5 shrink-0 text-ink" /> : null}
              </label>
            );
          })}
        </div>

        {method?.kind === 'pickup' && store.pickupInstructions ? (
          <p className="rounded-2xl bg-muted px-4 py-3 text-[13px] leading-relaxed text-ink-soft">
            {store.pickupInstructions}
          </p>
        ) : null}
      </fieldset>

      {/* --- Contact + address ------------------------------------------------- */}
      <section className="flex flex-col gap-4">
        <h2 className="text-[17px] font-extrabold tracking-tight">Tus datos</h2>
        <TextInput
          label="Nombre y apellido"
          name="recipientName"
          defaultValue={user.name}
          autoComplete="name"
          required
        />
        <TextInput
          label="Teléfono"
          name="phone"
          type="tel"
          inputMode="tel"
          defaultValue={user.phone ?? ''}
          autoComplete="tel"
          placeholder="099 123 456"
          hint="La tienda lo usa para coordinar la entrega."
          required
        />

        {requiresAddress ? (
          <>
            <SelectField
              label="Departamento"
              name="regionCode"
              value={regionCode}
              onChange={(event) => setRegionCode(event.target.value)}
              options={regions.map((item) => ({ value: item.code, label: item.name }))}
              required
            />
            <TextInput
              label="Localidad"
              name="locality"
              list="localidades"
              autoComplete="address-level2"
              placeholder={region?.localities[0] ?? 'Ciudad o barrio'}
              required
            />
            <datalist id="localidades">
              {region?.localities.map((locality) => (
                <option key={locality} value={locality} />
              ))}
            </datalist>
            <TextInput
              label="Dirección"
              name="street"
              autoComplete="street-address"
              placeholder="Calle, número, apartamento"
              required
            />
            <TextInput
              label="Código postal"
              name="postalCode"
              inputMode="numeric"
              autoComplete="postal-code"
              hint="Opcional en Uruguay."
            />
            <TextArea
              label="Observaciones"
              name="notes"
              rows={2}
              placeholder="Portero eléctrico, referencias, horarios"
              hint="Opcional."
            />
          </>
        ) : (
          <input type="hidden" name="regionCode" value="" />
        )}
      </section>

      {/* --- Payment ------------------------------------------------------------ */}
      <fieldset className="flex flex-col gap-3">
        <legend className="pb-2 text-[17px] font-extrabold tracking-tight">¿Cómo pagás?</legend>
        <div className="flex flex-col gap-2">
          {payment.map((option) => {
            const selected = option.id === paymentMethod?.id;
            return (
              <label
                key={option.id}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-2xl border bg-surface p-4 transition-colors',
                  selected ? 'border-ink ring-1 ring-ink' : 'border-line hover:bg-muted',
                )}
              >
                <input
                  type="radio"
                  name="paymentChoice"
                  value={option.id}
                  checked={selected}
                  onChange={() => {
                    setPaymentId(option.id);
                    if (!option.supportsInstallments) setInstallments(1);
                  }}
                  className="sr-only"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-[15px] font-bold">{option.label}</span>
                    {!option.live ? (
                      <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning-ink">
                        Simulado
                      </span>
                    ) : null}
                  </span>
                  <span className="block text-[13px] leading-snug text-subtle">
                    {option.description}
                  </span>
                </span>
                {selected ? <CheckIcon className="mt-0.5 size-5 shrink-0 text-ink" /> : null}
              </label>
            );
          })}
        </div>

        {paymentMethod?.supportsInstallments ? (
          <SelectField
            label="Cuotas"
            value={String(installments)}
            onChange={(event) => setInstallments(Number(event.target.value))}
            options={[1, 3, 6, 12]
              .filter((count) => count <= paymentMethod.maxInstallments)
              .map((count) => ({
                value: String(count),
                label:
                  count === 1
                    ? '1 pago'
                    : `${count} cuotas de ${money(Math.ceil(preview.totalMinor / count), preview.currency)}`,
              }))}
            hint="Valor referencial. El emisor define el plan final."
          />
        ) : null}
      </fieldset>

      <TextArea
        label="Nota para la tienda"
        name="buyerNote"
        rows={2}
        placeholder="Algo que el vendedor deba saber"
        hint="Opcional."
      />

      {/* --- Summary + commit --------------------------------------------------- */}
      <section className="flex flex-col gap-2 rounded-3xl bg-surface p-4 shadow-card">
        <h2 className="pb-1 text-[15px] font-extrabold">Resumen</h2>
        <Row label="Subtotal" value={money(preview.subtotalMinor, preview.currency)} />
        <Row
          label="Envío"
          value={
            preview.shippingMinor === 0
              ? 'Sin costo'
              : money(preview.shippingMinor, preview.currency)
          }
        />
        {/* The label comes from the priced preview, so an exempt or reduced
            line is described with the rule that was actually applied. */}
        <Row
          label={
            preview.tax.treatment === 'included'
              ? `${preview.tax.label} incluido`
              : preview.tax.label
          }
          value={money(preview.taxMinor, preview.currency)}
          muted
        />
        <div className="mt-1 flex items-baseline justify-between border-t border-line pt-3">
          <span className="text-[15px] font-extrabold">Total</span>
          <span
            aria-live="polite"
            className={cn(
              'text-[22px] font-extrabold tracking-tight transition-opacity',
              recalculating && 'opacity-40',
            )}
          >
            {money(preview.totalMinor, preview.currency)}
          </span>
        </div>
      </section>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur-lg">
        <div className="mx-auto max-w-2xl px-4 pb-safe pt-3">
          <Button
            type="submit"
            block
            size="lg"
            loading={submitting}
            disabled={submitting || recalculating}
            onClick={(event) => {
              const form = event.currentTarget.form;
              // Se arma el guard sólo cuando el envío va a ocurrir de verdad.
              // Antes se armaba siempre: si el primer toque quedaba bloqueado
              // por validación, `submitting` nunca pasaba a true, el efecto que
              // lo desarma nunca corría, y el botón quedaba muerto para
              // siempre — incluso después de completar la dirección.
              if (form && !readyToSubmit(form)) {
                event.preventDefault();
                return;
              }

              // A second tap before React re-renders would submit the form
              // twice; the server would deduplicate it, but the buyer would
              // still see a flash of the wrong thing.
              if (submitGuard.current) event.preventDefault();
              submitGuard.current = true;
            }}
          >
            {submitting ? 'Procesando…' : `Pagar ${money(preview.totalMinor, preview.currency)}`}
          </Button>
          <p aria-live="polite" className="pt-2 text-center text-[11px] leading-tight text-subtle">
            {submitting
              ? 'Confirmando tu pedido. No cierres esta pantalla.'
              : 'Pago simulado en esta versión. No se cobra nada.'}
          </p>
        </div>
      </div>
    </form>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={cn('text-[14px]', muted ? 'text-subtle' : 'text-ink-soft')}>{label}</span>
      <span className={cn('text-[14px] font-semibold', muted && 'text-subtle')}>{value}</span>
    </div>
  );
}
