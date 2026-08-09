/**
 * فاصل جوّه صف مرن لازم يبقى معاه `minWidth: 0`.
 *
 * antd's horizontal `Divider` carries `min-width: 100%`. Inside a flex row that beats whatever
 * `flex` says: the divider claims the entire width and shoves its neighbour out of the container
 * — off the screen, not merely out of place.
 *
 * On فاتورة البيع that neighbour was the «الأعمدة» button, which ended up at `left: -29`. All the
 * viewer saw was the gear icon poking past the edge of the window with its label clipped away, so
 * the control read as a stray artefact rather than as a button. Nothing was broken and nothing
 * logged; it just looked like a mistake, which is the kind of thing that survives for months.
 *
 * The rule is cheap to state and cheap to check, so it is checked rather than remembered.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..');

function sources(): [string, string][] {
  const out: [string, string][] = [];
  for (const dir of ['pages', 'components']) {
    for (const f of readdirSync(join(SRC, dir))) {
      if (!f.endsWith('.tsx')) continue;
      out.push([`${dir}/${f}`, readFileSync(join(SRC, dir, f), 'utf8')]);
    }
  }
  return out;
}

describe('الفاصل مايزقّش اللي جنبه بره الشاشة', () => {
  it('كل <Divider> بـ flex معاه minWidth: 0', () => {
    const offenders: string[] = [];
    for (const [name, src] of sources()) {
      // Every Divider tag, however it is wrapped across lines.
      for (const m of src.matchAll(/<Divider[^>]*?(?:\/>|>)/gs)) {
        const tag = m[0];
        if (!/flex:\s*1/.test(tag)) continue;          // not stretched — not the failure mode
        if (/minWidth:\s*0/.test(tag)) continue;       // guarded
        offenders.push(`${name}: ${tag.replace(/\s+/g, ' ').slice(0, 80)}`);
      }
    }
    expect(offenders, 'فاصل ممدود من غير minWidth: 0 — هيزقّ اللي جنبه بره').toEqual([]);
  });

  it('زرار الأعمدة مش بيتزنق', () => {
    // It sits beside headings and toolbars that take `flex: 1`. A squeezed button loses its label
    // first and then itself.
    const src = readFileSync(join(SRC, 'components', 'ColumnSettings.tsx'), 'utf8');
    expect(src).toMatch(/flexShrink: 0/);
  });
});
