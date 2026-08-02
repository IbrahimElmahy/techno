import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KEY_MAP } from './keyboard';

/**
 * The keyboard must not lie either.
 *
 * This system is used by people entering documents all day, and the promise it makes them is that
 * the hand never has to leave the keyboard. The promise was broken in a very specific and very
 * quiet way: `DocumentToolbar` printed «حفظ — F9» in the tooltip of every document screen, and
 * **nothing anywhere bound F9**. Twenty-five advertised keys across three screens, none of them
 * connected. Nobody reported it, because a key that does nothing is indistinguishable from a key
 * you pressed wrong.
 *
 * So these check the three ways the keyboard can go quiet again:
 *
 * 1. **A key advertised that the dispatcher does not know.** A toolbar action saying `shortcut:
 *    'F6'` binds nothing — `KEY_MAP` is the only list of keys that exist.
 * 2. **A screen with a create button and no way to reach it.** Either the screen registers `onNew`,
 *    or its button carries `data-shortcut="F2"` so the key can press it.
 * 3. **Two claimants for one key on one screen.** F2 must mean one thing per screen; two marked
 *    buttons and the answer is whichever the DOM happens to order first.
 *
 * They read the source rather than rendering, because what is being checked is agreement between
 * a tooltip, a keymap and a dispatcher that live in different files.
 */

const SRC = join(__dirname, '..');
const PAGES = join(SRC, 'pages');
const pageFiles = readdirSync(PAGES).filter((f) => f.endsWith('.tsx'));
const read = (f: string) => readFileSync(join(PAGES, f), 'utf8');

const knownKeys = new Set(KEY_MAP.map((k) => k.keys));

describe('the keys a toolbar advertises', () => {
  it('are all keys the dispatcher actually binds', () => {
    const offenders: string[] = [];
    [...pageFiles.map((f) => [f, read(f)] as const),
      ['components/DocumentToolbar.tsx',
        readFileSync(join(SRC, 'components/DocumentToolbar.tsx'), 'utf8')] as const,
    ].forEach(([file, src]) => {
      [...src.matchAll(/shortcut: '([^']+)'/g)].forEach((m) => {
        if (!knownKeys.has(m[1])) offenders.push(`${file}: ${m[1]}`);
      });
    });
    expect(offenders, 'a tooltip promising a key nothing binds').toEqual([]);
  });

  it('has an entry for every action a screen can register', () => {
    // The other direction: an action with no key is an action only the mouse can reach.
    const actions = new Set(KEY_MAP.map((k) => k.action));
    ['new', 'save', 'search', 'delete', 'print', 'close'].forEach((a) => {
      expect(actions.has(a as any), `${a} has no key`).toBe(true);
    });
  });
});

describe('«جديد» on every screen that has one', () => {
  /** Screens whose create button is reached some other way, with the reason it is not F2. */
  const EXEMPT: Record<string, string> = {
    'Settings.tsx': 'the + buttons add a row to a lookup list, not a document',
    'CouponReceipts.tsx': 'the + adds a serial range inside the open receipt',
    'FreeProduction.tsx': 'the + adds a line to the order being written',
    'Login.tsx': 'no create',
  };

  it('is reachable from the keyboard', () => {
    const unreachable: string[] = [];
    pageFiles.forEach((f) => {
      const src = read(f);
      // A screen that opens a create form from a primary button somewhere.
      const hasCreate = /icon=\{<(PlusOutlined|UserAddOutlined|FileAddOutlined)\s*\/>\}/.test(src)
        && src.includes('type="primary"');
      if (!hasCreate) return;
      const reachable = src.includes('data-shortcut="F2"')
        || src.includes("shortcut: 'F2'")
        || src.includes('onNew');
      if (!reachable && !(f in EXEMPT)) unreachable.push(f);
    });
    expect(unreachable, 'a create button the keyboard cannot press').toEqual([]);
  });

  it('has one claimant per screen', () => {
    const ambiguous = pageFiles
      .map((f) => [f, (read(f).match(/data-shortcut="F2"/g) || []).length] as const)
      .filter(([, n]) => n > 1)
      .map(([f, n]) => `${f}: ${n}`);
    expect(ambiguous, 'two buttons claiming F2 on one screen').toEqual([]);
  });
});

describe('the lines of a document', () => {
  it('let the arrows move between them wherever a quantity is typed', () => {
    // `data-qty-key` is the caret-landing marker the product loop uses; every one of those is a
    // line input, and every line input is somewhere the arrows should move rather than step.
    const missing: string[] = [];
    pageFiles.forEach((f) => {
      const src = read(f);
      if (!/data-qty-key=\{/.test(src)) return;
      if (!src.includes('data-grid-col="qty"')) missing.push(f);
      // antd binds Up/Down to +1/-1 on a number box. Both keys cannot mean two things.
      else if (!src.includes('keyboard={false}')) missing.push(`${f} (still stepping)`);
    });
    expect(missing, 'a lines table the arrows cannot walk').toEqual([]);
  });
});
