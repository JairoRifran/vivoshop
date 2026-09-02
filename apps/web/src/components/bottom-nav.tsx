'use client';

import { cn } from '@vivo/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BagIcon, BroadcastIcon, HomeIcon, SearchIcon, UserIcon } from './icons';

const TABS = [
  { href: '/', label: 'Inicio', Icon: HomeIcon },
  { href: '/explorar', label: 'Explorar', Icon: SearchIcon },
  { href: '/en-vivo', label: 'En vivo', Icon: BroadcastIcon, accent: true },
  { href: '/compras', label: 'Compras', Icon: BagIcon },
  { href: '/perfil', label: 'Perfil', Icon: UserIcon },
] as const;

/**
 * Primary buyer navigation.
 *
 * Fixed to the bottom because that is where a thumb is. Five destinations is
 * the ceiling: past that the targets get too narrow to hit reliably at 375 px,
 * which is the narrowest phone this product supports.
 */
export function BottomNav({ liveCount = 0 }: { liveCount?: number }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegación principal"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface/95 backdrop-blur-lg"
    >
      <ul className="mx-auto flex max-w-2xl items-stretch pb-safe">
        {TABS.map(({ href, label, Icon, ...rest }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          const accent = 'accent' in rest && rest.accent;

          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'group flex min-h-14 flex-col items-center justify-center gap-1 pt-2 text-[11px] font-semibold',
                  'transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus',
                  active ? 'text-brand' : 'text-subtle hover:text-ink-soft',
                )}
              >
                <span className="relative">
                  <Icon filled={active} className="size-6" />
                  {accent && liveCount > 0 ? (
                    <span
                      className="absolute -right-1.5 -top-1 flex min-w-4 items-center justify-center rounded-full bg-live px-1 text-[10px] font-bold leading-4 text-white"
                      aria-label={`${liveCount} transmisiones en vivo`}
                    >
                      {liveCount > 9 ? '9+' : liveCount}
                    </span>
                  ) : null}
                </span>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
