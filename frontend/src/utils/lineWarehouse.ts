export function cascadeWarehouse<T extends { key: string | number; warehouse_id?: number | null }>(
  lines: T[], key: T['key'], value: number | null, fallback: number | null = null,
): T[] {
  const i = lines.findIndex((l) => l.key === key);
  if (i < 0) return lines;
  const old = lines[i].warehouse_id ?? fallback;
  return lines.map((l, j) => (j === i || (j > i && (l.warehouse_id ?? fallback) === old)
    ? { ...l, warehouse_id: value } : l));
}
