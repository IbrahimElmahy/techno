import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { nextRowIndex } from './keyboard';

/**
 * السطر يتفتح — بالماوس وبالكيبورد، وبنفس الدالة.
 *
 * Two rules are worth holding still here, because both decay quietly.
 *
 * The first is the cursor arithmetic. Off-by-one at a boundary is not a crash — it is a held arrow
 * key that wraps to the top and an Enter that opens the wrong document, and the person doing it
 * has no reason to suspect the list rather than themselves.
 *
 * The second is the rule the whole change exists to establish: **a screen with a table either
 * answers a click on its rows or says why not**. That is how two thirds of the tables in this
 * system came to be dead in the first place — nobody decided they should be, each was simply built
 * without the question being asked. Written down, the next dead table is a failing test rather
 * than a discovery six months later.
 */

describe('حركة المؤشر في القايمة', () => {
  it('starts at the end you came in from', () => {
    // ↓ on a list nobody has touched means «من الأول», and ↑ means «من الآخر». Starting both at the
    // top would make ↑ move DOWN, which is the kind of thing you feel before you can name.
    expect(nextRowIndex(-1, 5, 'down')).toBe(0);
    expect(nextRowIndex(-1, 5, 'up')).toBe(4);
  });

  it('stops at the ends rather than wrapping', () => {
    expect(nextRowIndex(4, 5, 'down')).toBe(-1);
    expect(nextRowIndex(0, 5, 'up')).toBe(-1);
  });

  it('moves one row at a time in between', () => {
    expect(nextRowIndex(2, 5, 'down')).toBe(3);
    expect(nextRowIndex(2, 5, 'up')).toBe(1);
  });

  it('jumps to the first and last row', () => {
    expect(nextRowIndex(2, 5, 'first')).toBe(0);
    expect(nextRowIndex(2, 5, 'last')).toBe(4);
  });

  it('refuses to move in an empty list', () => {
    // A filter that matches nothing is the common way to arrive here, and every answer other than
    // «don't move» ends up indexing a row that is not there.
    (['up', 'down', 'first', 'last'] as const).forEach((to) => {
      expect(nextRowIndex(-1, 0, to)).toBe(-1);
    });
  });

  it('handles a one-row list, where every direction is the same row', () => {
    expect(nextRowIndex(-1, 1, 'down')).toBe(0);
    expect(nextRowIndex(-1, 1, 'up')).toBe(0);
    expect(nextRowIndex(0, 1, 'down')).toBe(-1);
    expect(nextRowIndex(0, 1, 'up')).toBe(-1);
  });
});

const PAGES = join(__dirname, '..', 'pages');
const pageFiles = readdirSync(PAGES).filter((f) => f.endsWith('.tsx'));
const read = (f: string) => readFileSync(join(PAGES, f), 'utf8');

/**
 * Screens whose rows open nothing, each with the reason.
 *
 * Being on this list is a decision, not an oversight — which is the entire point of it. A row that
 * genuinely has nothing behind it is fine; a row that has something behind it and ignores the
 * click is the defect this test exists to catch.
 */
const NO_ROW_ACTION: Record<string, string> = {
  'Settings.tsx':
    'كل خانة بتتعدّل في مكانها — الاسم والوصف والترتيب والظهور كلهم inline. مفيش «فورم تعديل» '
    + 'يتفتح، وفتح واحد هيكون خطوة زيادة على حاجة بتتعمل في ضغطة. وجدول فحص السلامة تشخيص، '
    + 'مش سجلات ليها صفحات.',
};

describe('كل شاشة فيها جدول، السطر فيها يعمل حاجة', () => {
  const withTable = pageFiles.filter((f) => /<Table[\s<>]/.test(read(f)));

  it('finds the tables to check at all', () => {
    // If a refactor renames or wraps `<Table>`, this suite would pass by checking nothing. It has
    // to fail loudly instead.
    expect(withTable.length).toBeGreaterThan(30);
  });

  it.each(withTable)('%s', (file) => {
    if (NO_ROW_ACTION[file]) return;
    const src = read(file);
    const answers = src.includes('useTableKeyboard') || /onRow\s*=/.test(src);
    expect(
      answers,
      `«${file}» فيها جدول والسطر مابيعملش حاجة. `
      + 'استعمل useTableKeyboard وحدّد onOpen، أو ضيفها لـ NO_ROW_ACTION بالسبب.',
    ).toBe(true);
  });
});

describe('الماوس والكيبورد بيفتحوا نفس الحاجة', () => {
  it('never lets a screen bind a row click separately from the key', () => {
    // The failure this prevents: a screen adopts the hook for the arrows, then writes its own
    // `onRow` for the click that opens something else. They agree on the day it is written and
    // disagree the first time either is changed.
    const both = pageFiles.filter((f) => {
      const src = read(f);
      return src.includes('useTableKeyboard') && /onRow=\{(?!.*tableProps)/.test(src);
    });
    expect(both, 'شاشة بتربط الضغط بالماوس لوحده جنب الكيبورد').toEqual([]);
  });
});
