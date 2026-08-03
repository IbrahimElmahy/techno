import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ENTRY_TYPE_LABEL, entryTypeLabel } from './labels';

/**
 * كل نوع قيد لازم يبقى ليه اسم عربي.
 *
 * A ledger entry is stored under a machine name because that is what code branches on. The screen
 * is not code — كشف حساب showing `sale_return` is the system talking to itself in front of the
 * user.
 *
 * It went wrong the ordinary way: حركة الخزينة had a private Arabic map, كشف الحساب had none, and
 * the private one covered ELEVEN of the nineteen types the backend actually writes. The eight
 * others showed through in English on both screens and nobody had a reason to notice, because a
 * label nobody recognises looks like a rare case rather than a missing translation.
 *
 * So this reads the backend for the types it really writes and fails if one has no Arabic name.
 * A new document kind added next year fails here rather than appearing raw on a customer's
 * statement.
 */

const BACKEND = join(__dirname, '..', '..', '..', 'backend', 'src');

/** Every `entry_type="..."` literal the backend posts. */
function backendEntryTypes(): Set<string> {
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '__pycache__') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.py')) continue;
      const src = readFileSync(p, 'utf8');
      for (const m of src.matchAll(/entry_type\s*=\s*"([a-z_]+)"/g)) found.add(m[1]);
    }
  };
  walk(BACKEND);
  return found;
}

describe('أسماء أنواع القيود', () => {
  it('covers every entry type the backend writes', () => {
    const missing = [...backendEntryTypes()].filter((t) => !(t in ENTRY_TYPE_LABEL));
    expect(missing, 'نوع قيد بيظهر بالإنجليزي في كشف الحساب').toEqual([]);
  });

  it('is checked against a backend that was actually read', () => {
    // If the scan finds nothing — a moved folder, a renamed argument — the test above passes by
    // having no work to do. Guard the guard.
    expect(backendEntryTypes().size).toBeGreaterThanOrEqual(10);
  });

  it('falls back to the raw value rather than to «غير معروف»', () => {
    // A type nobody has named yet is still information: «cheque_bounce» tells a reader something,
    // and «غير معروف» tells them nothing AND hides which row needs fixing.
    expect(entryTypeLabel('something_new')).toBe('something_new');
    expect(entryTypeLabel('sale')).toBe('فاتورة بيع');
    expect(entryTypeLabel(null)).toBe('-');
  });

  it('has no screen keeping a private copy of the map', () => {
    // The duplication was the cause, not the symptom: two maps meant one movement read as «سند
    // قبض» on one screen and `receipt` on the other.
    const pages = join(__dirname, '..', 'pages');
    const offenders = readdirSync(pages)
      .filter((f) => f.endsWith('.tsx'))
      .filter((f) => /ENTRY_TYPE_LABEL\s*:\s*Record/.test(readFileSync(join(pages, f), 'utf8')));
    expect(offenders, 'شاشة عاملة نسخة خاصة من خريطة الأسماء').toEqual([]);
  });
});
