"use client";
// ZoomZoom — icone SVG originali (brand e categorie), fedeli al prototipo.
import type { CSSProperties } from "react";

export function BrandMark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <rect x="2" y="2" width="44" height="44" rx="10" fill="#17334F" />
      <path d="M24 9 L38 21 V39 H10 V21 Z" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M24,17.2 L25.43,21.03 L29.52,21.21 L26.32,23.75 L27.41,27.69 L24,25.44 L20.59,27.69 L21.68,23.75 L18.48,21.21 L22.57,21.03 Z" fill="#C9A227" />
    </svg>
  );
}

const ICON_PATHS: Record<string, string> = {
  immobile: "M4 11 L12 4 L20 11 M6 10 V20 H18 V10 M10 20 V15 H14 V20",
  zona: "M9 4 L15 6 L21 4 L21 20 L15 18 L9 20 Z M15 6 V18",
  proprietario: "M14 10 A3 3 0 1 0 14.01 10 M8 20 C8 16 11 14 14 14 C17 14 20 16 20 20 M17 11 L21 15 M21 11 L17 15",
  affittuario: "M12 7 A4 4 0 1 0 12.01 7 M5 21 C5 16 8 14 12 14 C13.4 14 14.7 14.3 15.8 14.9 M18 15 L22 19 M22 15 L18 19",
  amministratore: "M5 21 V6 L12 3 L19 6 V21 M9 9 H11 M13 9 H15 M9 13 H11 M13 13 H15 M9 17 H15 M3 21 H21",
  agenzia: "M12 3 L21 8 H3 Z M5 8 V18 H19 V8 M9 12 V18 M15 12 V18 M3 18 H21 V21 H3 Z",
  ditta: "M14.5 4.5 L19.5 9.5 L10 19 L5 20 L4 15 Z M13 6 L17 10 M11 21 H21",
  consulente: "M12 2.5 L21.5 12 L12 21.5 L2.5 12 Z M12 7.5 L16.5 12 L12 16.5 L7.5 12 Z M12 2.5 V7.5 M12 16.5 V21.5 M2.5 12 H7.5 M16.5 12 H21.5",
};

export function iconSvg(name: string, size = 16, style?: CSSProperties) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>
      <path d={ICON_PATHS[name] || ICON_PATHS.immobile} />
    </svg>
  );
}

export const CheckSvg = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
    strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2.5 8.5l3.5 3.5 7-8" />
  </svg>
);
