import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * عرض العمود — الحاجات اللي اتكسرت وأنا بعملها، متسجّلة عشان ما تتكسرش تاني.
 *
 * Every rule below is here because the first version got it wrong and the browser said so. They are
 * not style preferences; each one is a way the feature silently stops working while the code still
 * looks correct — which is the only kind worth a test.
 */

const SRC = join(__dirname, '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const resize = read('components/ColumnResize.tsx');

describe('تغيير عرض العمود بالسحب', () => {
  it('re-applies widths with a timer, never requestAnimationFrame', () => {
    // The bug this replaced: rAF is SUSPENDED in a background tab, so a table that re-rendered
    // there left the coalescing flag stuck set and the widths were never restored. It looked like
    // «the resize does not stick» and was invisible in a focused tab.
    const observerBlock = resize.slice(resize.indexOf('new MutationObserver'));
    expect(observerBlock.slice(0, 500)).not.toMatch(/requestAnimationFrame/);
    expect(observerBlock.slice(0, 500)).toMatch(/setTimeout/);
  });

  it('coalesces the re-apply rather than running it per mutation', () => {
    // It watches the whole document. Typing into a cell fires mutations per keystroke, and
    // re-scanning every table on each of those would make the grid that most needs the widths the
    // one that stutters.
    expect(resize).toMatch(/if \(queued\) return;/);
  });

  it('keys widths by column NAME, not by index', () => {
    // Columns are hidden from الأعمدة on these screens. An index would slide every stored width
    // one place across the moment somebody hid one — every column silently wrong, none of them
    // obviously so.
    expect(resize).toMatch(/function keyFor/);
    expect(resize).toMatch(/headingOf/);
  });

  it('puts the grip on the inline-end edge, which is the LEFT one in this RTL app', () => {
    // Getting this backwards puts the handle on the neighbouring border, so the column that moves
    // is not the one you grabbed — and in an RTL app that is easy to write and easy to miss.
    expect(resize).toMatch(/direction === 'rtl'/);
    expect(resize).toMatch(/clientX - r\.left/);
  });

  it('stops the header click so a resize does not also sort the table', () => {
    // The header IS the sort button. Without this every drag re-sorts what you were reading.
    const down = resize.slice(resize.indexOf('const onDown'));
    expect(down.slice(0, 1200)).toMatch(/stopPropagation/);
  });

  it('forces a fixed layout before setting a width', () => {
    // In `auto` layout a <col> width is a suggestion the browser may ignore, which reads as a drag
    // that did nothing.
    expect(resize).toMatch(/tableLayout = 'fixed'/);
  });

  it('moves every colgroup, not just the first', () => {
    // A scrolling table renders a separate header table and body table, each with its own
    // colgroup. Moving one leaves the headings out of line with the cells beneath them.
    expect(resize).toMatch(/querySelectorAll\('colgroup'\)/);
  });

  it('is mounted above the router, so it does not depend on being logged in', () => {
    // It was first mounted inside the authenticated shell, where it also reset on every logout —
    // which is not what a saved preference means.
    const app = read('App.tsx');
    const provider = app.indexOf('<ColumnResizeProvider>');
    const router = app.indexOf('<Router');
    expect(provider).toBeGreaterThan(-1);
    expect(provider).toBeLessThan(router);
  });

  it('shows the grip, since a drag target nobody can see is a feature nobody finds', () => {
    const css = read('index.css');
    expect(css).toMatch(/\.ant-table-thead > tr > th:hover::before/);
    expect(css).toMatch(/inset-inline-start: 0/);
  });
});
