import { describe, expect, it } from 'vitest';
import {
  COMMISSION_POLICIES,
  DEFAULT_COMMISSION_POLICY,
  commissionPolicy,
  splitPayment,
} from './commission';

describe('política de comisión', () => {
  it('cobra 3% por defecto', () => {
    expect(COMMISSION_POLICIES.standard.rateBps).toBe(300);
    expect(commissionPolicy(undefined).name).toBe(DEFAULT_COMMISSION_POLICY);
  });

  it('cae en la estándar ante un nombre desconocido', () => {
    // Una tienda con una política borrada no puede quedar sin comisión por
    // accidente: eso sería regalar plata en silencio.
    expect(commissionPolicy('la-que-no-existe').rateBps).toBe(300);
  });

  it('tiene las variantes que el negocio va a necesitar', () => {
    expect(COMMISSION_POLICIES.launch_promotion.rateBps).toBe(0);
    expect(COMMISSION_POLICIES.high_volume.rateBps).toBe(250);
    expect(COMMISSION_POLICIES.custom_agreement.rateBps).toBe(200);
  });
});

describe('reparto del dinero', () => {
  it('separa 3% de un monto redondo', () => {
    const split = splitPayment(100_000, COMMISSION_POLICIES.standard);
    expect(split.commissionMinor).toBe(3_000);
    expect(split.netMinor).toBe(97_000);
  });

  it('no cobra nada en la promoción de lanzamiento', () => {
    const split = splitPayment(149_000, COMMISSION_POLICIES.launch_promotion);
    expect(split.commissionMinor).toBe(0);
    expect(split.netMinor).toBe(149_000);
  });

  it('redondea a favor del vendedor', () => {
    // 3% de 1.333 son 39,99 centésimos. El medio centésimo indivisible se lo
    // queda quien vende, no la plataforma.
    const split = splitPayment(1_333, COMMISSION_POLICIES.standard);
    expect(split.commissionMinor).toBe(39);
    expect(split.netMinor).toBe(1_294);
  });

  it('comisión y neto suman siempre el bruto exacto', () => {
    // La propiedad que impide que aparezca o desaparezca un centésimo.
    for (const gross of [1, 7, 99, 100, 1_333, 149_000, 999_999, 1_000_001]) {
      for (const policy of Object.values(COMMISSION_POLICIES)) {
        const split = splitPayment(gross, policy);
        expect(split.commissionMinor + split.netMinor).toBe(gross);
        expect(split.commissionMinor).toBeGreaterThanOrEqual(0);
        expect(split.netMinor).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('congela la tasa y el nombre de la política en el pago', () => {
    // Si mañana cambia la comisión, lo cobrado ayer tiene que poder explicarse
    // sin consultar la política vigente.
    const split = splitPayment(50_000, COMMISSION_POLICIES.high_volume);
    expect(split.commissionRateBps).toBe(250);
    expect(split.commissionPolicy).toBe('high_volume');
  });
});
