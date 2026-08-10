import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * البوباب مايتبعش المستخدم على تبويب تاني.
 *
 * The workspace keeps every open screen MOUNTED and hides the inactive ones with `display: none`
 * (see `TabWorkspace`). A dialog does not live in that div — antd renders it through a portal on
 * `document.body` — so a dialog left open on one screen sat on top of whatever screen you switched
 * to. You would open فاتورة, leave the item picker open, go to الخزينة, and find the item picker
 * over it; «حفظ» then posted against the invoice you were no longer looking at.
 *
 * `TabModal` holds the one condition that fixes it. This checks nothing goes around it — a screen
 * reaching for antd's `Modal` directly gets the old behaviour back silently, on that screen only,
 * and nobody would notice until a user posted to the wrong document.
 */

const SRC = join(__dirname, '..');

/** Every .tsx under src/, since dialogs live in components as much as in pages. */
function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return entry.endsWith('.tsx') ? [full] : [];
  });
}

const read = (f: string) => readFileSync(f, 'utf8');
const rel = (f: string) => f.slice(SRC.length + 1).replace(/\\/g, '/');

describe('dialogs are tied to the tab that opened them', () => {
  it('no screen renders antd Modal or Drawer directly', () => {
    const offenders = tsxFiles(SRC)
      .filter((f) => rel(f) !== 'components/TabModal.tsx')
      .filter((f) => /<(Modal|Drawer)[\s/>]/.test(read(f)))
      .map(rel);

    expect(offenders, 'a dialog that would follow the user onto another tab').toEqual([]);
  });

  it('TabModal actually gates on whether its tab is showing', () => {
    const src = read(join(SRC, 'components', 'TabModal.tsx'));
    expect(src).toContain('useOnScreen');
    // Both wrappers, not just the one somebody remembered.
    expect(src).toMatch(/export function TabModal[\s\S]*open=\{!!open && onScreen\}/);
    expect(src).toMatch(/export function TabDrawer[\s\S]*open=\{!!open && onScreen\}/);
  });

  it('hiding does not wait for a close animation', () => {
    /**
     * `open: false` alone was NOT enough, and this is the part that is easy to lose.
     *
     * antd removes a dialog from view only when its close animation reports that it finished, and
     * a window that is not painting delivers no animation frames. The dialog then sits on screen,
     * frozen mid-fade, with `open` already false — which looks exactly like the bug this was
     * supposed to fix. The class does the hiding on the same render instead.
     */
    const src = read(join(SRC, 'components', 'TabModal.tsx'));
    expect(src, 'nothing hides the dialog independently of the animation')
      .toContain('tab-dialog-away');
    // Applied to the ROOT, so the mask goes with it — hiding the wrapper alone leaves the grey
    // sheet lying over the screen you switched to.
    expect(src).toMatch(/rootClassName=\{away\(onScreen/);

    const css = read(join(SRC, 'index.css'));
    expect(css, 'the class exists but nothing hides anything').toMatch(
      /\.tab-dialog-away\s*\{[^}]*display:\s*none\s*!important/);
  });

  it('the static Modal.confirm calls are deliberately left alone', () => {
    // They are calls, not elements, and short-lived — nobody leaves one open and walks away. If a
    // future antd made them elements this stops being true, so the assumption is written down.
    const statics = tsxFiles(SRC)
      .filter((f) => /Modal\.(confirm|warning|info|error|success|useModal)/.test(read(f)));
    expect(statics.length, 'no static Modal calls left — has the pattern changed?')
      .toBeGreaterThan(0);
  });

  it('inactive tabs really are still mounted — the reason any of this matters', () => {
    // If TabWorkspace ever unmounts inactive tabs, the portal problem disappears and this whole
    // rule becomes noise. Pinned so the guard is deleted deliberately rather than left lying.
    const workspace = read(join(SRC, 'components', 'TabWorkspace.tsx'));
    expect(workspace).toContain("display: t.id === activeId ? 'block' : 'none'");
  });
});
