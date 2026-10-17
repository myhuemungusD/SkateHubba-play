/**
 * Profile photo constrained to the slot it paints in.
 * Avatars are stored at 400px; `sizes` tells the browser the display width
 * so a future smaller candidate can win without a layout change.
 */
export function AvatarImage({ src, size, className }: { src: string; size: number; className?: string }) {
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      decoding="async"
      sizes={`${size}px`}
      srcSet={`${src} 400w`}
      className={className}
    />
  );
}
