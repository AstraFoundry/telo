import { cn } from "@/shared/lib/cn";

/**
 * Telegram draws download progress as a ring, never a bar: the ring sits on
 * the media it belongs to without claiming a row of layout, so the same
 * control works over a photo, inside an album tile, and beside a file name.
 * Telegram Web K's is a 54px circle of `r = 24` at stroke-width 2
 * (`components/preloader.ts:92-108`), which these constants mirror; the
 * component scales by `size` rather than re-deriving the geometry.
 */
const VIEWBOX = 54;
const RADIUS = 24;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/**
 * A ring drawn at exactly 0% reads as broken rather than as pending, so
 * Telegram floors the visible arc (`preloader.ts:311`).
 */
const MIN_ARC = 5;
/** Fraction of the ring an indeterminate pass keeps lit, matching Web K. */
const INDETERMINATE_ARC = 0.6;

export interface ProgressRingProps {
  /**
   * Completed fraction in `0..1`, or null when the total is unknown — then
   * the ring shows a fixed arc and spins, which is the honest rendering of
   * "downloading, length unknown" rather than a fabricated percentage.
   */
  readonly value: number | null;
  /** Screen-reader name; the ring renders no text of its own. */
  readonly label: string;
  /** Outer diameter in pixels. */
  readonly size?: number;
  readonly className?: string;
}

export function ProgressRing({
  value,
  label,
  size = 40,
  className,
}: ProgressRingProps) {
  const determinate = value !== null;
  const fraction = determinate ? Math.min(1, Math.max(0, value)) : 0;
  const arc = determinate
    ? Math.max(MIN_ARC, fraction * CIRCUMFERENCE)
    : INDETERMINATE_ARC * CIRCUMFERENCE;

  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      // An indeterminate progressbar omits the value; announcing 0% while
      // bytes are arriving would be worse than announcing nothing.
      aria-valuenow={determinate ? Math.round(fraction * 100) : undefined}
      style={{ width: size, height: size }}
      className={cn("relative grid shrink-0 place-items-center", className)}
    >
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
        className={cn(
          "size-full",
          // The determinate ring turns slowly so the arc still reads as
          // progress; the indeterminate one is the only motion available, so
          // it turns at the usual spinner rate. Reduced motion keeps the arc
          // and drops the rotation: the arc is the information.
          "animate-spin motion-reduce:animate-none",
          determinate && "[animation-duration:2s]",
        )}
      >
        <circle
          cx={VIEWBOX / 2}
          cy={VIEWBOX / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={`${arc} ${CIRCUMFERENCE}`}
          className="stroke-current transition-[stroke-dasharray] duration-200 ease-out motion-reduce:transition-none"
        />
      </svg>
    </span>
  );
}
