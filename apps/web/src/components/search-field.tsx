'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { SearchIcon } from './icons';

/**
 * Debounced search that keeps the query in the URL.
 *
 * The URL is the state: results are still rendered on the server, the page is
 * shareable, and the back button behaves. `useTransition` is what turns the
 * pending navigation into a visible spinner without blocking typing.
 */
export function SearchField({ defaultValue = '' }: { defaultValue?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(defaultValue);
  const [pending, startTransition] = useTransition();
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }

    const timeout = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (value.trim()) next.set('q', value.trim());
      else next.delete('q');

      startTransition(() => {
        router.replace(`/explorar${next.size > 0 ? `?${next.toString()}` : ''}`, { scroll: false });
      });
    }, 300);

    return () => clearTimeout(timeout);
  }, [value, params, router]);

  return (
    <search className="relative">
      <label htmlFor="buscar" className="sr-only">
        Buscar tiendas y productos
      </label>
      <SearchIcon
        aria-hidden
        className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-subtle"
      />
      <input
        id="buscar"
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Buscar tiendas o productos"
        autoComplete="off"
        className="h-13 w-full rounded-2xl border border-line bg-surface pl-11 pr-11 text-[16px] text-ink placeholder:text-subtle focus:border-focus focus:outline-none focus:ring-2 focus:ring-focus/25"
      />
      {pending ? (
        <span
          role="status"
          aria-label="Buscando"
          className="absolute right-4 top-1/2 size-5 -translate-y-1/2 animate-spin rounded-full border-2 border-subtle border-t-transparent motion-reduce:animate-none"
        />
      ) : null}
    </search>
  );
}
