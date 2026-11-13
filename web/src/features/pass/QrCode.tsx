import { useMemo } from 'react';
import { encode } from 'uqr';

/**
 * A QR code drawn as one SVG path: black modules on white, crisp at any size. Low error correction
 * keeps the modules large for a link this long; a phone screen does not get dirty.
 */
export function QrCode({ text, label }: { text: string; label: string }) {
  const { size, path } = useMemo(() => {
    const qr = encode(text, { ecc: 'L', border: 2 });
    let d = '';
    qr.data.forEach((row, y) => {
      row.forEach((on, x) => {
        if (on) d += `M${x} ${y}h1v1h-1z`;
      });
    });
    return { size: qr.size, path: d };
  }, [text]);
  return (
    <svg
      className="qr"
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
