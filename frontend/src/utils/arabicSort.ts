export function normalizeAr(value: any): string {
  return String(value ?? '')
    .replace(/[ً-ْٰ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const arCollator = new Intl.Collator('ar', { numeric: true });

export function compareArabic(a?: string | null, b?: string | null): number {
  return arCollator.compare(normalizeAr(a), normalizeAr(b));
}

export function sortByName<T>(rows: T[], name: (r: T) => string | null | undefined): T[] {
  return [...rows].sort((x, y) => compareArabic(name(x), name(y)));
}

function optionText(option: any): string {
  const raw = option?.label ?? option?.title ?? option?.children ?? option?.value;
  const shown = normalizeAr(typeof raw === 'string' || typeof raw === 'number' ? raw : '');
  const hidden = option?.search;
  return typeof hidden === 'string' ? `${shown} ${normalizeAr(hidden)}` : shown;
}

export function searchFilter(input: string, option: any): boolean {
  return matchesWords(optionText(option), normalizeAr(input));
}

export function matchesWords(text: string, needle: string): boolean {
  if (!needle) return true;
  return needle.split(' ').every((w) => text.includes(w));
}

export function matchRank(text: string, needle: string): 0 | 1 | 2 {
  if (!needle) return 0;
  const first = needle.split(' ')[0];
  if (text.startsWith(first)) return 0;
  if (text.includes(' — ') && text.split(' — ').some((part) => part.trim().startsWith(first))) return 0;
  if (text.includes(` ${first}`)) return 1;
  return 2;
}

let rankFor = '';
let rankCache = new WeakMap<object, { t: string; r: number }>();
function optionRank(o: any, n: string): { t: string; r: number } {
  if (n !== rankFor) { rankFor = n; rankCache = new WeakMap(); }
  const hit = o && typeof o === 'object' ? rankCache.get(o) : undefined;
  if (hit) return hit;
  const t = optionText(o);
  const out = { t, r: matchRank(t, n) };
  if (o && typeof o === 'object') rankCache.set(o, out);
  return out;
}

export function searchRank(a: any, b: any, info?: { searchValue?: string }): number {
  const n = normalizeAr(info?.searchValue ?? '');
  if (!n) return 0;
  const x = optionRank(a, n);
  const y = optionRank(b, n);
  return (x.r - y.r) || arCollator.compare(x.t, y.t);
}

function looksLikeCode(needle: string): boolean {
  return /\d/.test(needle) && !/[؀-ۿ]/.test(needle);
}

export function searchByName<T>(
  rows: T[],
  needle: string,
  name: (r: T) => string | null | undefined,
  code?: (r: T) => string | null | undefined,
): T[] {
  if (!needle) return rows;
  const codeFirst = looksLikeCode(needle);
  const hits: { row: T; t: string; r: number }[] = [];
  for (const row of rows) {
    const t = normalizeAr(name(row));
    const c = code ? normalizeAr(code(row)) : '';
    let r: number;
    if (codeFirst && c && c.startsWith(needle)) r = -1;
    else if (matchesWords(t, needle)) r = matchRank(t, needle);
    else if (c && c.includes(needle)) r = 3;
    else continue;
    hits.push({ row, t, r });
  }
  hits.sort((a, b) => (a.r - b.r) || arCollator.compare(a.t, b.t));
  return hits.map((h) => h.row);
}
