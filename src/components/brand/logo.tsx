/** Símbolo de Volkra (tres lóbulos con hueco central), dibujado a partir del logo original. */
export function VolkraMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path d="M50 6c-11 0-19 8-19 19v14c-6 1-11 4-15 8-12 2-20 12-20 24 0 13 10 23 23 23 6 0 11-2 15-6 5-4 10-5 16-5s11 1 16 5c4 4 9 6 15 6 13 0 23-10 23-23 0-12-8-22-20-24-4-4-9-7-15-8V25C69 14 61 6 50 6Z" fill="#2A2B27" opacity="0" />
      <path d="M31 40V25c0-11 8-19 19-19s19 8 19 19v15c-5-3-12-5-19-5s-14 2-19 5Z" fill="#2A2B27" />
      <path d="M31 40c-6 4-10 11-10 18 0 6 2 11 6 15-4 4-10 7-16 6C4 77-1 70 0 62c1-9 9-16 18-17 5-1 9-3 13-5Z" fill="#4A5D5E" />
      <path d="M69 40c6 4 10 11 10 18 0 6-2 11-6 15 4 4 10 7 16 6 7-2 12-9 11-17-1-9-9-16-18-17-5-1-9-3-13-5Z" fill="#A3A897" />
      <path d="M27 73c5 6 13 9 23 9s18-3 23-9c-6 3-13 5-23 5s-17-2-23-5Z" fill="#4A5D5E" opacity="0.9" />
    </svg>
  );
}

export function VolkraLogo({ subtitle }: { subtitle?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <VolkraMark />
      <div className="leading-tight">
        <div className="font-heading text-[15px] font-medium tracking-[0.28em]">VOLKRA</div>
        {subtitle ? <div className="text-[11px] text-muted-foreground">{subtitle}</div> : null}
      </div>
    </div>
  );
}
