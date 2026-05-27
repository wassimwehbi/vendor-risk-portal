interface BrandMarkProps {
  /** Rendered px size. Header uses 28, the login/invite cards use 44. */
  size?: number;
  className?: string;
}

/**
 * Vendor Risk Portal brand mark — a shield with an inset checkmark.
 *
 * The shield silhouette nods to the security domain; the white check nods to
 * the human-validation theme (a human analyst always signs off, never the AI).
 * Replaces the former "VR" text monogram. The SVG carries its own shape, so it
 * needs no background, border, or radius. Colors track the `brand` palette in
 * `tailwind.config.js` via Tailwind `fill-`/`stroke-` utilities, so the mark
 * follows the accent if the palette ever changes.
 */
export function BrandMark({ size = 28, className }: BrandMarkProps) {
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
