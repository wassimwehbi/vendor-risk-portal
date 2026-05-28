interface BrandMarkProps {
  /** Rendered px size. Header uses 26, the sign-in card uses ~40. */
  size?: number;
  className?: string;
}

/**
 * Vendor Risk Portal brand mark — a shield with an inset checkmark. This mirrors the canonical
 * mark in `client/src/components/BrandMark.tsx` (same path geometry); colors come from the brand
 * tokens via the `.fill-brand-600` / `.stroke-brand-700` utilities in styles.css, so it tracks the
 * design system. (Do NOT replace this with a text monogram — the SVG superseded the old "VR" mark.)
 */
export function BrandMark({ size = 26, className }: BrandMarkProps) {
  return (
    <svg viewBox="0 0 28 28" width={size} height={size} fill="none" aria-hidden="true" className={className}>
      <path
        d="M14 3.25 5 6v6.7c0 5.05 3.5 9.5 9 11.05 5.5-1.55 9-6 9-11.05V6l-9-2.75Z"
        className="fill-brand-600 stroke-brand-700"
        strokeWidth="0.75"
      />
      <path
        d="M9.75 13.6 12.7 16.5 18.25 11"
        stroke="#fff"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
