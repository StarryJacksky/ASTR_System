export interface StaticSoulLensProps {
  readonly className?: string;
}

export function StaticSoulLens({ className }: StaticSoulLensProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      data-static-soul-lens="true"
      focusable="false"
      viewBox="0 0 160 160"
    >
      <path
        className="lensOuter"
        d="M 63 18 A 64 64 0 1 0 94 18"
        pathLength="1"
      />
      <path className="lensNotch" d="M 63 18 L 73 32 L 94 18" />
      <circle className="lensShell" cx="80" cy="80" r="42" />
      <circle className="lensContinuity" cx="80" cy="80" r="57" />
      <path
        className="lensFacet"
        d="M 80 47 L 109 68 L 98 105 L 62 105 L 51 68 Z"
      />
      <circle className="lensCore" cx="80" cy="80" r="13" />
      <path className="lensAxis" d="M 80 34 V 46 M 80 114 V 126 M 34 80 H 46 M 114 80 H 126" />
    </svg>
  );
}
