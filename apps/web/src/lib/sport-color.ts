const PALETTE = [
  "#00d4aa",
  "#7b61ff",
  "#ffaa00",
  "#ff6b6b",
  "#06b6d4",
  "#f97316",
  "#a855f7",
  "#84cc16",
  "#ec4899",
  "#14b8a6",
];

export function sportColor(sport: string | null | undefined): string {
  const key = (sport ?? "").toLowerCase();
  if (!key) return "#3f3f46";
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) >>> 0;
  }
  return PALETTE[h % PALETTE.length];
}
