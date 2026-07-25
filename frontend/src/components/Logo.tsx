import React from 'react';

/**
 * TechnoTherm brand mark, drawn as vector so it stays crisp on screen, on print and at any
 * size without shipping a bitmap. `mark` is the house+leaf only (tight spaces like a collapsed
 * sidebar or a favicon); `full` adds the wordmark and the «GERMAN TECHNOLOGY» line.
 */

export const BRAND = {
  green: '#3FA92B',
  orange: '#F07C1E',
  ink: '#111111',
  nameAr: 'تكنو ثيرم',
  nameEn: 'TechnoTherm',
  tagline: 'GERMAN TECHNOLOGY',
};

/** The house + leaf mark on its own, as raw SVG markup (also reused by the print templates). */
export function markSvg(size = 48, color = BRAND.green): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 120 120" fill="none"
    xmlns="http://www.w3.org/2000/svg" aria-label="TechnoTherm">
    <path d="M14 56 L60 16 L106 56" stroke="${color}" stroke-width="9"
          stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M26 62 V96 H46" stroke="${color}" stroke-width="9"
          stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M94 62 V96 H74" stroke="${color}" stroke-width="9"
          stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M60 40 C40 56 40 78 58 88 C76 78 78 54 60 40 Z" fill="${color}"/>
    <path d="M60 52 C60 72 60 84 52 96 C50 100 54 104 58 102 C68 96 68 74 66 60"
          stroke="${color}" stroke-width="6" stroke-linecap="round" fill="none"/>
  </svg>`;
}

/** The full lock-up as raw SVG markup — used by the printed letterheads. */
export function logoSvg(width = 220): string {
  const height = Math.round(width * 0.62);
  return `<svg width="${width}" height="${height}" viewBox="0 0 320 200" fill="none"
    xmlns="http://www.w3.org/2000/svg" aria-label="TechnoTherm — German Technology">
    <g transform="translate(100 0)">
      <path d="M14 56 L60 16 L106 56" stroke="${BRAND.green}" stroke-width="9"
            stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M26 62 V96 H46" stroke="${BRAND.green}" stroke-width="9"
            stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M94 62 V96 H74" stroke="${BRAND.green}" stroke-width="9"
            stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M60 40 C40 56 40 78 58 88 C76 78 78 54 60 40 Z" fill="${BRAND.green}"/>
      <path d="M60 52 C60 72 60 84 52 96 C50 100 54 104 58 102 C68 96 68 74 66 60"
            stroke="${BRAND.green}" stroke-width="6" stroke-linecap="round" fill="none"/>
    </g>
    <text x="160" y="152" text-anchor="middle"
          font-family="Verdana, Tahoma, sans-serif" font-size="42" font-weight="700">
      <tspan fill="${BRAND.green}">Techno</tspan><tspan fill="${BRAND.orange}">Therm</tspan>
    </text>
    <rect x="42" y="162" width="236" height="4" fill="${BRAND.green}"/>
    <text x="160" y="188" text-anchor="middle" fill="${BRAND.ink}"
          font-family="Verdana, Tahoma, sans-serif" font-size="19" font-weight="700"
          letter-spacing="2.4">${BRAND.tagline}</text>
  </svg>`;
}

export default function Logo({
  variant = 'full', width, color, style,
}: {
  variant?: 'full' | 'mark';
  width?: number;
  color?: string;          // mark-only override, e.g. white on the gradient header
  style?: React.CSSProperties;
}) {
  const html = variant === 'mark' ? markSvg(width ?? 40, color ?? BRAND.green) : logoSvg(width ?? 200);
  return <span style={{ display: 'inline-flex', ...style }} dangerouslySetInnerHTML={{ __html: html }} />;
}
