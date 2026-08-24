'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker after the page is interactive, so it never
 * competes with the first render for bandwidth on a slow connection.
 *
 * Development is excluded on purpose: a cached shell during hot reload is a
 * reliable way to waste an afternoon.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // Registration failing is not a user-visible problem: the app works
        // exactly as before, just without the offline fallback.
      });
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });

    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
