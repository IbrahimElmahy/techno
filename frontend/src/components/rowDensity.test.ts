import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ارتفاع الصف واحد في النظام كله.
 *
 * Somebody reading a count sheet of four hundred lines wants them tight enough to see a screenful;
 * somebody typing counts into that same sheet wants them loose enough to hit the right box. Letting
 * each of them choose is the whole point — and the choice has to reach EVERY table, or it is not a
 * system setting, it is a quirk of the screens that happened to get it.
 *
 * There are 173 tables here. The way this decays is obvious the moment you picture the alternative:
 * somebody threads a `size` prop through a few of them, a screen written next month does not know
 * to, and the row height starts depending on which page you are on. So the mechanism is one
 * attribute on the root and one CSS rule, and these hold it there.
 */

const SRC = join(__dirname, '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

describe('التحكم في ارتفاع الصف', () => {
  const css = read('index.css');
  const component = read('components/RowDensity.tsx');

  it('styles every table through the root attribute, not through any one screen', () => {
    // The selector must reach `.ant-table-tbody` from `html[data-density]` — anything scoped to a
    // page or a component would be a setting that only some tables obey.
    ['compact', 'normal', 'comfortable'].forEach((d) => {
      expect(css, `مفيش قاعدة لـ «${d}»`)
        .toMatch(new RegExp(`html\\[data-density='${d}'\\][^{]*\\.ant-table-tbody`));
    });
  });

  it('beats antd\'s own per-table size', () => {
    // antd writes cell padding from each table's `size`. Without the override, a screen saying
    // `size="small"` would ignore what the person using it just asked for.
    const compactRule = css.slice(css.indexOf("html[data-density='compact']"));
    expect(compactRule.slice(0, 400)).toMatch(/padding:[^;]*!important/);
  });

  it('gives the three levels genuinely different heights', () => {
    // Three names for the same padding is a control that appears to do nothing, which is worse
    // than not having one.
    const pad = (d: string) => {
      const at = css.indexOf(`html[data-density='${d}'] .ant-table-tbody`);
      const m = /padding:\s*([0-9]+)px/.exec(css.slice(at, at + 300));
      return Number(m![1]);
    };
    expect(pad('compact')).toBeLessThan(pad('normal'));
    expect(pad('normal')).toBeLessThan(pad('comfortable'));
  });

  it('leaves the font size alone', () => {
    // Shrinking the text to fit more rows is how a dense screen becomes an unreadable one, and
    // somebody counting stock is reading numbers they cannot afford to misread.
    const block = css.slice(css.indexOf("html[data-density='compact']"),
      css.indexOf('السطر اللي الكيبورد واقف عليه'));
    expect(block).not.toMatch(/font-size/);
  });

  it('remembers the choice', () => {
    // Re-choosing it every morning is the same as not having it.
    expect(component).toMatch(/localStorage/);
  });

  it('is mounted above the whole app, so dialogs follow it too', () => {
    // A table inside a modal is still a table. Mounting the provider below the layout would leave
    // every picker and detail sheet on the default.
    expect(read('App.tsx')).toMatch(/<DensityProvider>/);
  });

  it('puts the control where it reads as a system setting', () => {
    expect(read('components/AppLayout.tsx')).toMatch(/<RowDensityControl \/>/);
  });
});
