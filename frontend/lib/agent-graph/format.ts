const UNITS: [number, string][] = [
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "k"],
];

export const formatTokens = (n: number): string => {
  for (const [size, unit] of UNITS) {
    if (n >= size) return `${(n / size).toFixed(n >= size * 100 ? 0 : 1)}${unit}`;
  }
  return String(Math.round(n));
};

export const formatCost = (n: number): string => (n >= 100 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`);

export const formatElapsed = (fromIso: string | undefined, nowMs: number): string => {
  if (!fromIso) return "";
  const s = Math.max(0, Math.round((nowMs - Date.parse(fromIso)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};
