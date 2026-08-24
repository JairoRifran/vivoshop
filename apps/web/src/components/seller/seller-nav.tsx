'use client';

import { cn } from '@vivo/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BoxIcon, HomeIcon, MoreIcon, TruckIcon } from '@/components/icons';

const TABS = [
  { href: '/vender', label: 'Inicio', Icon: HomeIcon, exact: true },
  { href: '/vender/productos', label: 'Productos', Icon: BoxIcon },
  { href: '/vender/pedidos', label: 'Pedidos', Icon: TruckIcon },
  { href: '/vender/mas', label: 'Más', Icon: MoreIcon },
] as const;

/**
 * Seller navigation.
 *
 * Four tabs plus a raised broadcast button in the middle. Transmitting is the
 * one action the whole surface exists for, so it is not a peer of the others:
 * it is bigger, centred, and reachable without looking.
 */
/**
 * Single-task screens hide the navigation.
 *
 * Not a cosmetic choice: the raised broadcast button overlaps the fixed submit
 * bar these forms use, so on a phone it physically covered "Publicar
 * producto". Removing the nav fixes the collision and matches what the screen
 * is for — a form you finish or abandon with the back arrow, not a place to
 * wander off from.
 */
const FOCUSED_ROUTES = [
  '/vender/productos/nuevo',
  '/vender/lives/nuevo',
  /^\/vender\/productos\/[^/]+$/,
];

function isFocusedRoute(pathname: string): boolean {
  return FOCUSED_ROUTES.some((route) =>
    typeof route === 'string' ? pathname === route : route.test(pathname),
  );
}

export function SellerNav({ liveSessionId }: { liveSessionId: string | null }) {
  const pathname = usePathname();
  const broadcastHref = liveSessionId ? `/transmitir/${liveSessionId}` : '/vender/lives/nuevo';

  if (isFocusedRoute(pathname)) return null;

  return (
    <nav
      aria-label="Navegación de vendedor"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-[#14141a]/95 backdrop-blur-lg"
    >
      <ul className="mx-auto grid max-w-2xl grid-cols-5 items-end pb-safe">
        {TABS.slice(0, 2).map((tab) => (
          <NavTab key={tab.href} tab={tab} pathname={pathname} />
        ))}

        <li className="flex justify-center">
          <Link
            href={broadcastHref}
            className={cn(
              'relative -mt-6 flex size-16 flex-col items-center justify-center gap-0.5 rounded-full',
              'bg-live text-white shadow-lg shadow-live/35 transition-transform',
              'active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
              'motion-reduce:active:scale-100',
            )}
          >
            {liveSessionId ? (
              <span className="absolute -top-1 right-1 size-3 animate-pulse rounded-full bg-white motion-reduce:animate-none" />
            ) : null}
            <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
              <path d="M7.4 7.4a6.5 6.5 0 0 0 0 9.2M16.6 16.6a6.5 6.5 0 0 0 0-9.2" strokeLinecap="round" />
            </svg>
            <span className="text-[10px] font-extrabold uppercase tracking-wide">
              {liveSessionId ? 'En vivo' : 'Transmitir'}
            </span>
          </Link>
        </li>

        {TABS.slice(2).map((tab) => (
          <NavTab key={tab.href} tab={tab} pathname={pathname} />
        ))}
      </ul>
    </nav>
  );
}

function NavTab({
  tab,
  pathname,
}: {
  tab: (typeof TABS)[number];
  pathname: string;
}) {
  const active =
    'exact' in tab && tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);

  return (
    <li>
      <Link
        href={tab.href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex min-h-14 flex-col items-center justify-center gap-1 pt-2 text-[11px] font-semibold transition-colors',
          'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white',
          active ? 'text-white' : 'text-white/55 hover:text-white/80',
        )}
      >
        <tab.Icon filled={active} className="size-6" />
        {tab.label}
      </Link>
    </li>
  );
}
