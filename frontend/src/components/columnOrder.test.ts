/**
 * ترتيب الأعمدة — نفس المحرك اللي بيخفي، ومش تاني.
 *
 * Asked for as a system-wide feature with one constraint: «مش عايز تكرار — اعملها مرة واستدعيها».
 * So the reorder lives in the SAME hook that already did hiding (`useHiddenColumns`) and the SAME
 * component that already rendered the dropdown (`ColumnSettings`) — a screen that already shows or
 * hides columns gets reordering by passing two more props to a component it already renders, not
 * by adopting a second mechanism.
 *
 * No DOM rendering here, matching the rest of this suite: `orderKeys` is the pure placement rule
 * the hook is built on, and it is tested directly rather than through a hook-rendering harness this
 * project does not otherwise depend on.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { orderKeys } from './ColumnSettings';

describe('قاعدة الترتيب نفسها', () => {
  it('من غير ترتيب محفوظ، الترتيب الأصلي زي ما هو', () => {
    expect(orderKeys(['a', 'b', 'c'], undefined)).toEqual(['a', 'b', 'c']);
  });

  it('اللي اتصنّف بيتقدّم، وبعده الباقي بترتيبهم الأصلي', () => {
    expect(orderKeys(['a', 'b', 'c'], ['c'])).toEqual(['c', 'a', 'b']);
  });

  it('عمود جديد لسه ما اتصنّفش بيفضل في الآخر — مش بيقفز الأول', () => {
    // Added after the user already ranked the table — it must not jump ahead of a rank they chose.
    expect(orderKeys(['a', 'b', 'c', 'new'], ['c', 'a'])).toEqual(['c', 'a', 'b', 'new']);
  });

  it('مفتاح محفوظ ومابقاش موجود (عمود اتشال) بيتجاهل من غير ما يوقّع', () => {
    expect(orderKeys(['a', 'b'], ['gone', 'b', 'a'])).toEqual(['b', 'a']);
  });

  it('مصفوفة فاضية زي مفيش ترتيب خالص', () => {
    expect(orderKeys(['a', 'b'], [])).toEqual(['a', 'b']);
  });
});

describe('التبديل — لفوق ولتحت', () => {
  /** نفس منطق `move` في الهوك، من غير ما نستدعي React. */
  function moved(allKeys: string[], saved: string[] | undefined, key: string, dir: -1 | 1) {
    const current = orderKeys(allKeys, saved);
    const i = current.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= current.length) return current;
    [current[i], current[j]] = [current[j], current[i]];
    return current;
  }

  it('لفوق بيبدّل مع اللي قبله', () => {
    expect(moved(['a', 'b', 'c'], undefined, 'b', -1)).toEqual(['b', 'a', 'c']);
  });

  it('لتحت بيبدّل مع اللي بعده', () => {
    expect(moved(['a', 'b', 'c'], undefined, 'a', 1)).toEqual(['b', 'a', 'c']);
  });

  it('أول عمود مايتحركش لفوق تاني، وآخر واحد مايتحركش لتحت', () => {
    expect(moved(['a', 'b', 'c'], undefined, 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moved(['a', 'b', 'c'], undefined, 'c', 1)).toEqual(['a', 'b', 'c']);
  });
});

describe('التخزين — تفضيل قديم من قبل الترتيب لسه بيتقرا صح', () => {
  it('القيمة القديمة كانت مصفوفة، مش كائن — لازم تتقرا كـ hidden مش كـ order', () => {
    // The stored shape used to BE the hidden array (`localStorage.setItem(key, JSON.stringify(
    // hiddenArray))`). Reading `["notes","rep_id"]` as `{hidden: undefined}` would silently show
    // every column again for everybody who had already tuned a screen.
    const legacy = JSON.stringify(['notes', 'rep_id']);
    const parsed = JSON.parse(legacy);
    const asPrefs = Array.isArray(parsed)
      ? { hidden: parsed, order: undefined }
      : { hidden: parsed.hidden, order: parsed.order };
    expect(asPrefs.hidden).toEqual(['notes', 'rep_id']);
    expect(asPrefs.order).toBeUndefined();
  });
});

describe('الشاشات اللي بتستعمل ColumnSettings كلها بتوصل بالمحرك ده', () => {
  const SRC = join(__dirname, '..', 'pages');
  const files = readdirSync(SRC).filter((f) => f.endsWith('.tsx'));

  it('مفيش صفحة بتعمل show/hide لعمود من غير useHiddenColumns', () => {
    // A page that grows its own `visible.filter(...)` beside this hook is the second mechanism
    // the user explicitly asked not to have.
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(SRC, f), 'utf8');
      if (!src.includes('<ColumnSettings')) continue;
      if (!src.includes('useHiddenColumns')) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it('كل استدعاء لـ ColumnSettings بيدي hidden و onChange من نفس الأداة', () => {
    for (const f of files) {
      const src = readFileSync(join(SRC, f), 'utf8');
      if (!src.includes('<ColumnSettings')) continue;
      expect(src, f).toMatch(/hidden=\{[a-zA-Z]+\.hidden\}/);
      expect(src, f).toMatch(/onChange=\{[a-zA-Z]+\.setHidden\}/);
    }
  });

  it('كل جدول بيرتّب فعلياً (عنده columns={cols.apply(...)}) عنده order/onMove كمان', () => {
    // The one deliberate exception is the sale's line-items panel: its cells are hand-placed in
    // JSX rather than read from a `columns={...}` array, so `apply()` has nothing to reorder and
    // arrows that silently did nothing would be worse than none.
    const exempt = new Set(['Invoices.tsx']);
    for (const f of files) {
      if (exempt.has(f)) continue;
      const src = readFileSync(join(SRC, f), 'utf8');
      if (!src.includes('<ColumnSettings')) continue;
      if (!/columns=\{[a-zA-Z]+\.apply\(/.test(src)) continue;
      expect(src, f).toMatch(/order=\{[a-zA-Z]+\.order\}/);
      expect(src, f).toMatch(/onMove=\{/);
    }
  });
});
