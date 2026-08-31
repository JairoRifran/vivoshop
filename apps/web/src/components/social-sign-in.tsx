import { GoogleMark, MetaMark } from '@/components/icons';
import { publicApiUrl } from '@/lib/api';

const LABELS: Record<string, { label: string; mark: React.ReactNode }> = {
  google: { label: 'Continuar con Google', mark: <GoogleMark className="size-5" /> },
  meta: { label: 'Continuar con Facebook', mark: <MetaMark className="size-5" /> },
};

/**
 * Los botones de ingreso social.
 *
 * Son **enlaces**, no botones con `onClick`, y eso no es un detalle: OAuth
 * necesita que el navegador navegue de verdad a otro dominio. Un `fetch` no
 * sirve —lo frenaría CORS, y aunque no lo frenara, la persona tiene que ver la
 * pantalla de Google para saber a quién le está dando permiso—.
 *
 * Van directo a la API y no pasan por una acción de servidor: lo que arranca
 * acá es una redirección, no una llamada con sesión, así que no hay cookie que
 * llevar. El `state` y el PKCE se generan del lado del servidor de la API.
 *
 * Si no hay proveedores habilitados no se dibuja nada. Un botón que lleva a un
 * error es peor que no tenerlo.
 */
export function SocialSignIn({ providers, next }: { providers: string[]; next: string }) {
  if (providers.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3" aria-hidden>
        <span className="h-px flex-1 bg-line" />
        <span className="text-[13px] font-semibold text-subtle">o</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      {providers.map((provider) => {
        const meta = LABELS[provider];
        if (!meta) return null;

        return (
          <a
            key={provider}
            href={`${publicApiUrl()}/auth/${provider}/start?next=${encodeURIComponent(next)}`}
            className="inline-flex h-13 w-full items-center justify-center gap-3 rounded-2xl border border-line bg-surface px-4 text-[15px] font-bold text-ink transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {meta.mark}
            {meta.label}
          </a>
        );
      })}
    </div>
  );
}
