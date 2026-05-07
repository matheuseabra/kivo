"use client";

interface BrandLogoProps {
  size?: number;
  showWordmark?: boolean;
  titleClassName?: string;
}

export function BrandLogo({
  size = 24,
  showWordmark = true,
  titleClassName = "text-2xl font-semibold text-neutral-100 tracking-tight",
}: BrandLogoProps) {
  return (
    <span className="flex items-center gap-2">
      <img src="/kivo-mark.svg" alt="Kivo" width={size} height={size} className="shrink-0" />
      {showWordmark && <span className={titleClassName}>Kivo</span>}
    </span>
  );
}
