'use client';

import { ASPECT_RATIO, MAX_IMAGE_EDGE, type UploadPurpose } from '@vivo/domain';
import { Spinner, cn } from '@vivo/ui';
import { useId, useRef, useState } from 'react';
import { requestUpload } from '@/lib/actions/media';

type Status = 'idle' | 'working' | 'error';

/**
 * Elegir una imagen, recortarla y subirla — sin salir del formulario.
 *
 * Lo que el formulario recibe es un campo oculto con la **clave**, no una URL:
 * es lo que el servidor puede verificar como nuestro. Vacío significa "no la
 * toqué"; `null` explícito significa "sacala".
 *
 * ## Por qué el recorte pasa acá y no en el servidor
 *
 * Una foto de un teléfono son 8 a 12 MB. Subirla entera para que el servidor la
 * achique es pagar el ancho de banda del peor caso —el de quien está con datos
 * móviles— y además tener que correr un decodificador de imágenes sobre bytes
 * que mandó cualquiera. El navegador ya tiene el decodificador, ya tiene la
 * imagen en memoria, y achicarla ahí cuesta unos milisegundos y ahorra el 95%
 * de la subida.
 *
 * El recorte es *cover* centrado, con la proporción que pide el propósito: sin
 * eso alguien sube una foto vertical de portada y la tienda se ve rota.
 */
export function ImageField({
  name,
  purpose,
  label,
  hint,
  currentUrl,
  shape = 'square',
  fallback,
}: {
  name: string;
  purpose: UploadPurpose;
  label: string;
  hint?: string;
  currentUrl: string | null;
  shape?: 'square' | 'circle' | 'wide';
  fallback?: React.ReactNode;
}) {
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(currentUrl);
  const [key, setKey] = useState<string>('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string>('');

  async function onPick(file: File | undefined): Promise<void> {
    if (!file) return;

    setStatus('working');
    setMessage('');

    try {
      const blob = await downscale(file, purpose);
      const target = await requestUpload(purpose, blob.type);
      if (!target) throw new Error('sign');

      if (blob.size > target.maxBytes) throw new Error('too-big');

      const response = await fetch(target.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': blob.type },
        body: blob,
      });
      if (!response.ok) throw new Error(`upload:${response.status}`);

      setKey(target.key);
      setPreview(URL.createObjectURL(blob));
      setStatus('idle');
    } catch {
      setStatus('error');
      setMessage('No pudimos subir la imagen. Probá de nuevo.');
    }
  }

  function remove(): void {
    // La cadena `null` es literal: el servidor la distingue de "no vino nada",
    // que significa dejar la imagen como está.
    setKey('null');
    setPreview(null);
    setStatus('idle');
    setMessage('');
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-semibold text-ink">{label}</span>

      {/*
        Apaisada apila; cuadrada y circular van al lado del texto.

        Una sola fila para las tres formas parecia mas simple y no lo era: la
        portada ocupa todo el ancho, asi que la ayuda quedaba en una columna de
        una palabra por linea y se salia de la tarjeta. Con `wide` la miniatura
        ya no es una miniatura --es una franja-- y el texto va debajo.
      */}
      <div className={cn('flex gap-3', shape === 'wide' ? 'flex-col' : 'items-center')}>
        <label
          htmlFor={inputId}
          className={cn(
            'relative grid cursor-pointer place-items-center overflow-hidden border border-line bg-muted transition-colors hover:bg-muted-strong focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus',
            shape === 'circle' && 'size-20 shrink-0 rounded-full',
            shape === 'square' && 'size-20 shrink-0 rounded-2xl',
            shape === 'wide' && 'h-24 w-full rounded-2xl',
          )}
        >
          {preview ? (
            // <img> plano: es una previsualización local o una URL de nuestro
            // bucket, y el optimizador de Next agregaría un viaje sin ahorrar
            // nada.
            <img src={preview} alt="" className="size-full object-cover" />
          ) : (
            (fallback ?? <span className="text-[12px] font-semibold text-subtle">Elegir</span>)
          )}

          {status === 'working' ? (
            <span className="absolute inset-0 grid place-items-center bg-ink/45">
              <Spinner className="text-surface" />
            </span>
          ) : null}

          <input
            ref={fileRef}
            id={inputId}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(event) => void onPick(event.target.files?.[0])}
          />
        </label>

        <div
          className={cn(
            'flex min-w-0 flex-col gap-1',
            // Apilada no compite por el ancho: `flex-1` la estiraria al alto de
            // la franja y dejaria el texto flotando en el medio.
            shape === 'wide' ? 'items-start' : 'flex-1',
          )}
        >
          {hint ? <p className="text-[12px] leading-snug text-subtle">{hint}</p> : null}
          {preview ? (
            <button
              type="button"
              onClick={remove}
              className="self-start text-[13px] font-bold text-danger underline-offset-2 hover:underline"
            >
              Quitar
            </button>
          ) : null}
        </div>
      </div>

      {status === 'error' ? (
        <p role="alert" className="text-[13px] font-semibold text-danger">
          {message}
        </p>
      ) : null}

      <input type="hidden" name={name} value={key} />
    </div>
  );
}

/**
 * Achica y recorta, en el navegador.
 *
 * WebP cuando el navegador lo sabe escribir —pesa entre un 25% y un 35% menos
 * a igual calidad— y JPEG si no. La calidad 0.85 es donde la diferencia deja de
 * verse a simple vista en una foto de perfil.
 */
async function downscale(file: File, purpose: UploadPurpose): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const ratio = ASPECT_RATIO[purpose];
  const maxEdge = MAX_IMAGE_EDGE[purpose];

  // Cover centrado: se recorta lo que sobra del lado más largo en vez de
  // deformar la imagen.
  const sourceRatio = bitmap.width / bitmap.height;
  const cropWidth = sourceRatio > ratio ? bitmap.height * ratio : bitmap.width;
  const cropHeight = sourceRatio > ratio ? bitmap.height : bitmap.width / ratio;
  const sx = (bitmap.width - cropWidth) / 2;
  const sy = (bitmap.height - cropHeight) / 2;

  const width = Math.min(maxEdge, Math.round(cropWidth));
  const height = Math.round(width / ratio);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas');
  context.drawImage(bitmap, sx, sy, cropWidth, cropHeight, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/webp', 0.85);
  });
  if (blob && blob.type === 'image/webp') return blob;

  const jpeg = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', 0.85);
  });
  if (!jpeg) throw new Error('encode');
  return jpeg;
}
