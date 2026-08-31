import type { SVGProps } from 'react';

/**
 * Hand-rolled icon set.
 *
 * An icon library would add tens of kilobytes and a dependency for the twelve
 * glyphs this product actually uses. These are plain SVG, tree-shaken by
 * definition, and inherit `currentColor` so a single class recolours them.
 */
type IconProps = SVGProps<SVGSVGElement> & { filled?: boolean };

function Base({ filled = false, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    />
  );
}

export const HomeIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M3.5 10.5 12 3.75l8.5 6.75V19a1.5 1.5 0 0 1-1.5 1.5h-3.75v-6h-6.5v6H5A1.5 1.5 0 0 1 3.5 19z" />
  </Base>
);

export const SearchIcon = (props: IconProps) => (
  <Base {...props}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </Base>
);

export const BroadcastIcon = (props: IconProps) => (
  <Base {...props}>
    <circle cx="12" cy="12" r="2.75" />
    <path d="M7.4 7.4a6.5 6.5 0 0 0 0 9.2M16.6 16.6a6.5 6.5 0 0 0 0-9.2M4.6 4.6a10.5 10.5 0 0 0 0 14.8M19.4 19.4a10.5 10.5 0 0 0 0-14.8" />
  </Base>
);

export const BagIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M5.5 8h13l-1 11.5a1.5 1.5 0 0 1-1.5 1.35H8a1.5 1.5 0 0 1-1.5-1.35z" />
    <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
  </Base>
);

export const UserIcon = (props: IconProps) => (
  <Base {...props}>
    <circle cx="12" cy="8.5" r="3.75" />
    <path d="M4.75 20a7.25 7.25 0 0 1 14.5 0" />
  </Base>
);

export const HeartIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M12 20s-7.5-4.6-7.5-9.4A4.1 4.1 0 0 1 12 8.2a4.1 4.1 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20z" />
  </Base>
);

export const ShareIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M12 15V4M12 4 8.5 7.5M12 4l3.5 3.5" />
    <path d="M5.5 13v5.5a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5V13" />
  </Base>
);

export const EyeIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" />
    <circle cx="12" cy="12" r="2.75" />
  </Base>
);

export const ChatIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M4.5 17.5V6.5A1.5 1.5 0 0 1 6 5h12a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 18 16H8.5z" />
  </Base>
);

export const PlusIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M12 5v14M5 12h14" />
  </Base>
);

export const ChevronRightIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="m9.5 6 6 6-6 6" />
  </Base>
);

export const ChevronLeftIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="m14.5 6-6 6 6 6" />
  </Base>
);

export const CheckIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Base>
);

export const CameraIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M4.5 8.5h3l1.2-2h6.6l1.2 2h3A1.5 1.5 0 0 1 21 10v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18v-8a1.5 1.5 0 0 1 1.5-1.5z" />
    <circle cx="12" cy="14" r="3.25" />
  </Base>
);

export const MicIcon = (props: IconProps) => (
  <Base {...props}>
    <rect x="9" y="3" width="6" height="10.5" rx="3" />
    <path d="M5.5 12a6.5 6.5 0 0 0 13 0M12 18.5V21" />
  </Base>
);

export const SwitchCameraIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M4 9.5A6.5 6.5 0 0 1 15.5 6M20 14.5A6.5 6.5 0 0 1 8.5 18" />
    <path d="M4 5v4.5h4.5M20 19v-4.5h-4.5" />
  </Base>
);

export const BoxIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M12 3.5 20 7v10l-8 3.5L4 17V7z" />
    <path d="M4 7l8 3.5L20 7M12 10.5V20.5" />
  </Base>
);

export const TruckIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M3 7.5h10.5V16H3zM13.5 10.5H17l3 3V16h-6.5z" />
    <circle cx="7" cy="17.5" r="1.75" />
    <circle cx="17" cy="17.5" r="1.75" />
  </Base>
);

export const StoreIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M4 9.5 5.2 5h13.6L20 9.5M4 9.5h16M4 9.5v9A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-9" />
    <path d="M9.5 20v-5h5v5" />
  </Base>
);

export const MoreIcon = (props: IconProps) => (
  <Base {...props}>
    <circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
  </Base>
);

export const CalendarIcon = (props: IconProps) => (
  <Base {...props}>
    <rect x="3.5" y="5.5" width="17" height="15" rx="2" />
    <path d="M3.5 10h17M8 3.5v4M16 3.5v4" />
  </Base>
);

/**
 * La G de Google, con sus cuatro colores exactos.
 *
 * Los colores están escritos y no salen del tema: son marca registrada de
 * Google y sus condiciones de uso exigen el logo tal cual. Es de los pocos
 * lugares del proyecto donde un color no responde al modo claro/oscuro, y es a
 * propósito.
 */
export function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden className={className}>
      <path
        fill="#4285F4"
        d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.2-3.8 6.6-9.5 6.6-16.1z"
      />
      <path
        fill="#34A853"
        d="M24 46c6 0 11-2 14.5-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.6-3.9-12.3-9.1H4.3v5.7C7.8 41 15.3 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.7 28.1c-.4-1.3-.7-2.7-.7-4.1s.3-2.8.7-4.1v-5.7H4.3C2.8 17.1 2 20.4 2 24s.8 6.9 2.3 9.8l7.4-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.8c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.2 30 2 24 2 15.3 2 7.8 7 4.3 14.2l7.4 5.7c1.7-5.2 6.6-9.1 12.3-9.1z"
      />
    </svg>
  );
}

/** La f de Facebook. Mismo criterio que `GoogleMark`: color de marca, fijo. */
export function MetaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <path
        fill="#1877F2"
        d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.96h-1.51c-1.49 0-1.96.93-1.96 1.89v2.26h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07z"
      />
    </svg>
  );
}
