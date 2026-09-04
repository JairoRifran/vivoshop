import { REPORT_REASONS, REPORT_STATUSES, REPORT_TARGETS, REPORT_DETAIL_MAX } from '@vivo/domain';
import { z } from 'zod';
import { idSchema, isoDateSchema } from './primitives';

/**
 * Denunciar y bloquear.
 *
 * El mismo esquema valida el formulario en la web y el cuerpo en la API: una
 * sola definición, para que el cliente y el servidor no puedan discrepar sobre
 * qué es una denuncia válida.
 */
export const createReportRequestSchema = z.object({
  target: z.enum(REPORT_TARGETS),
  targetId: z.string().min(1).max(120),
  reason: z.enum(REPORT_REASONS),
  /**
   * Opcional de verdad.
   *
   * Pedir que expliquen para poder denunciar es una barrera justo cuando la
   * persona está incómoda. El motivo ya dice bastante; el texto es para quien
   * quiere agregar contexto.
   */
  detail: z.string().max(REPORT_DETAIL_MAX).default(''),
});
export type CreateReportRequest = z.input<typeof createReportRequestSchema>;

export const reportSchema = z.object({
  id: z.string(),
  reporterId: idSchema,
  target: z.enum(REPORT_TARGETS),
  targetId: z.string(),
  reason: z.enum(REPORT_REASONS),
  detail: z.string(),
  status: z.enum(REPORT_STATUSES),
  createdAt: isoDateSchema,
  resolvedAt: isoDateSchema.nullable(),
  resolvedBy: idSchema.nullable(),
});
export type ReportDto = z.infer<typeof reportSchema>;

export const resolveReportRequestSchema = z.object({
  status: z.enum(['dismissed', 'actioned']),
});
export type ResolveReportRequest = z.infer<typeof resolveReportRequestSchema>;

/** Una cuenta bloqueada, como la muestra la pantalla del perfil. */
export const blockedPersonSchema = z.object({
  id: idSchema,
  name: z.string(),
  avatarUrl: z.string().nullable(),
  since: isoDateSchema,
});
export type BlockedPersonDto = z.infer<typeof blockedPersonSchema>;

/** Cómo se lee cada motivo en la pantalla. */
export const REPORT_REASON_LABEL: Record<(typeof REPORT_REASONS)[number], string> = {
  spam: 'Spam o publicidad',
  ofensivo: 'Insultos o acoso',
  estafa: 'Parece una estafa',
  sexual: 'Contenido sexual',
  violencia: 'Violencia',
  prohibido: 'Producto prohibido',
  otro: 'Otra cosa',
};
