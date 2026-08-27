'use client';

import { Button } from '@vivo/ui';
import { useRouter } from 'next/navigation';
import { useOptimistic, useState, useTransition } from 'react';
import { toggleFollow } from '@/lib/actions/social';
import { track } from '@/lib/analytics';
import { LiveNotificationsPrompt } from './live-notifications';

/**
 * Follow toggle with an optimistic flip.
 *
 * Following is a low-stakes, high-frequency action during a live, so it has to
 * feel instant. The optimistic value is reconciled against whatever the server
 * returns, and a signed-out visitor is sent to sign in instead of silently
 * failing.
 */
export function FollowButton({
  storeId,
  storeName,
  following,
  size = 'sm',
  variant,
  className,
}: {
  storeId: string;
  storeName: string;
  following: boolean;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'light' | 'dark';
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(following);
  /**
   * El diálogo aparece **después** de seguir, y solo entonces.
   *
   * Seguir y aceptar avisos son dos decisiones, y el navegador solo pregunta
   * una vez: mezclarlas gastaría esa pregunta en alguien que todavía no sabe
   * para qué era.
   */
  const [askAboutNotifications, setAskAboutNotifications] = useState(false);

  const handleClick = () => {
    startTransition(async () => {
      setOptimistic(!optimistic);
      const result = await toggleFollow(storeId, optimistic);

      if (result.requiresAuth) {
        router.push(`/ingresar?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }

      track(result.following ? 'store_followed' : 'store_unfollowed', { storeId });
      if (result.following) setAskAboutNotifications(true);
      router.refresh();
    });
  };

  const dark = variant === 'dark';

  return (
    <>
      <Button
      size={size}
      variant={optimistic ? (dark ? 'ghost' : 'secondary') : dark ? 'live' : 'primary'}
      onClick={handleClick}
      disabled={pending}
      aria-pressed={optimistic}
      className={[
        dark && optimistic ? 'border border-white/30 text-white hover:bg-white/10' : '',
        className ?? '',
      ].join(' ')}
    >
        {optimistic ? 'Siguiendo' : 'Seguir'}
        <span className="sr-only"> a {storeName}</span>
      </Button>

      {askAboutNotifications ? (
        <LiveNotificationsPrompt
          storeId={storeId}
          storeName={storeName}
          onClose={() => setAskAboutNotifications(false)}
        />
      ) : null}
    </>
  );
}
