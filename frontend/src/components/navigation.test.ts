import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { EXTRA_SECTIONS, NAVIGATION, allScreens } from './navigation';

/**
 * The menu must not lie.
 *
 * The navigation tree mirrors the client's a5 menu — all fifty-seven screens — so every entry is a
 * promise about where a click lands. Three ways that promise has actually been broken here, each
 * found by hand and each now checked:
 *
 * 1. **A parameter the screen never reads.** `/finance-reports?view=balance-sheet` looked right and
 *    the screen read `?tab=`, so four different accounting reports all opened on قائمة الدخل.
 * 2. **A tab that does not exist.** `/purchases?tab=returns` landed silently on «فاتورة شراء
 *    جديدة» — worse than a dead link, because somebody who lands on the wrong tab believes they
 *    arrived and searches a screen that was never going to have it.
 * 3. **An unbuilt screen with nothing to say.** Falling through to PendingScreen is fine; falling
 *    through with no explanation leaves «لسه بتتبني» and no next step.
 *
 * These read the source rather than rendering, because what is being checked is agreement between
 * three files that are edited at different times by different hands.
 */

const SRC = join(__dirname, '..');
const routesSrc = readFileSync(join(SRC, 'components/PageRoutes.tsx'), 'utf8');
const pendingSrc = readFileSync(join(SRC, 'pages/PendingScreen.tsx'), 'utf8');
const docLinkSrc = readFileSync(join(SRC, 'components/DocumentLink.tsx'), 'utf8');

const declaredPaths = new Set(
  [...routesSrc.matchAll(/path="(\/[^"/:]+)"/g)].map((m) => m[1]),
);
const pathToComponent = Object.fromEntries(
  [...routesSrc.matchAll(/path="(\/[^"/:]+)" element=\{<(\w+)/g)].map((m) => [m[1], m[2]]),
);
const componentToFile = Object.fromEntries(
  [...routesSrc.matchAll(/import (\w+) from '\.\.\/pages\/([\w/]+)'/g)].map((m) => [m[1], m[2]]),
);
/** Keys PendingScreen has written an explanation for. */
const explained = new Set(
  [...pendingSrc.matchAll(/^ {2}'([^']+)': \{/gm)].map((m) => m[1]),
);

/** Which query parameters a screen actually reads. `*` means it reads the raw search params. */
function paramsRead(source: string): Set<string> {
  const got = new Set<string>();
  for (const m of source.matchAll(/useQueryTab\(\s*[^,)]+(?:,\s*'([^']+)')?\s*\)/g)) {
    got.add(m[1] ?? 'tab');   // 'tab' is the hook's default parameter name
  }
  if (source.includes('useSectionParam(')) got.add('section');
  if (source.includes('useSearchParams(')) got.add('*');
  return got;
}

function sourceFor(path: string): string | null {
  const file = componentToFile[pathToComponent[path]];
  if (!file) return null;
  const full = join(SRC, 'pages', `${file}.tsx`);
  return existsSync(full) ? readFileSync(full, 'utf8') : null;
}

const routed = allScreens().filter((s) => declaredPaths.has(s.key.split('?')[0]));
const unbuilt = allScreens().filter((s) => !declaredPaths.has(s.key.split('?')[0]));

describe('every menu entry lands on what it names', () => {
  it.each(routed.filter((s) => s.key.includes('?')).map((s) => [s.label, s.key]))(
    '«%s» → %s: the screen reads every parameter the entry sends',
    (_label, key) => {
      const source = sourceFor(key.split('?')[0]);
      if (!source) return;                       // component not resolvable from the route table
      const read = paramsRead(source);
      const sent = [...new URLSearchParams(key.split('?')[1]).keys()];
      for (const name of sent) {
        expect(read.has('*') || read.has(name),
          `entry sends ?${name}= but the screen never reads it`).toBe(true);
      }
    },
  );

  it.each(routed.filter((s) => /[?&]tab=/.test(s.key)).map((s) => [s.label, s.key]))(
    '«%s» → %s: the tab it names exists on that screen',
    (_label, key) => {
      const source = sourceFor(key.split('?')[0]);
      if (!source) return;
      const tab = new URLSearchParams(key.split('?')[1]).get('tab')!;
      expect(source.includes(`key: '${tab}'`) || source.includes(`value: '${tab}'`),
        `entry opens tab «${tab}», which that screen has not got`).toBe(true);
    },
  );
});

describe('unbuilt screens', () => {
  /**
   * Every one of their fifty-seven screens now has a route. That makes the useful assertion the
   * inverse of what it was: not «the unbuilt ones explain themselves» but «there are none» — a new
   * menu entry added without a screen behind it should fail here rather than reach somebody as a
   * page that says it is still being built.
   */
  it('there are none left — every menu entry has a screen', () => {
    expect(unbuilt.map((s) => `${s.label} → ${s.key}`)).toEqual([]);
  });

  // Kept for when a future entry lands ahead of its screen: PendingScreen is still the honest
  // landing place, and an entry that goes there has to say what is missing and what to use instead.
  it.each(unbuilt.map((s) => [s.label, s.key]))(
    '«%s» → %s has a written explanation',
    (_label, key) => {
      expect(explained.has(key),
        'add an entry to PENDING in PendingScreen.tsx: what it will do, and the nearest thing '
        + 'that exists today').toBe(true);
    },
  );
});

/**
 * A document link is the same promise as a menu entry, one level down: «this number opens that
 * document». It was broken the same way — `DocumentLink` listed `return` and `voucher` among the
 * kinds it could open while neither screen read the id, so «افتح المستند» landed on a list and
 * left the reader to find the row they had just clicked. One of those screens learned to open it;
 * the other had no per-document view at all and was removed from the map rather than left lying.
 */
describe('every document kind opens the document, not its list', () => {
  const SCREEN = Object.fromEntries(
    // The map literal, read straight out of the source it is declared in.
    [...docLinkSrc.matchAll(/^ {2}(\w+): '(\/[\w-]+)',/gm)].map((m) => [m[1], m[2]]),
  );

  it('the map is not empty (the regex still matches the source)', () => {
    expect(Object.keys(SCREEN).length).toBeGreaterThan(0);
  });

  it.each(Object.entries(SCREEN))(
    'kind «%s» → %s reads ?doc=',
    (_kind, path) => {
      const source = sourceFor(path);
      expect(source, `${path} has no component in the route table`).toBeTruthy();
      expect(source!.includes("searchParams.get('doc')"),
        `${path} is offered as a place to open a document but never reads ?doc=, so the link `
        + 'lands on a list').toBe(true);
    },
  );
});


describe('the shape of the menu', () => {
  /**
   * قسم جواه مدخل واحد مش قسم.
   *
   * Eight of them existed: «اذن تحويل مخزن» opened to reveal «اذون التحويل» and nothing else, so
   * reaching one screen took two clicks and a guess about what was inside. A group is a promise
   * that there is a choice to make; with one child there is no choice, only a lid.
   *
   * The child keeps the GROUP's name when flattened — that is the wording people scan for.
   */
  const groupsWithOneChild = (nodes: any[], path: string[] = []): string[] => {
    const bad: string[] = [];
    nodes.forEach((n) => {
      if (!n.children) return;
      if (n.children.length === 1) bad.push([...path, n.label].join(' › '));
      bad.push(...groupsWithOneChild(n.children, [...path, n.label]));
    });
    return bad;
  };

  it('has no section wrapping a single entry', () => {
    // The MENU TREE, not `allScreens()` — that flattens groups away, which is exactly the shape
    // this rule is about. Walking the tree is the only way to see a group at all.
    expect(groupsWithOneChild([...NAVIGATION, ...EXTRA_SECTIONS]), 'قسم جواه مدخل واحد').toEqual([]);
  });

  it('still has real sections, so the rule did not flatten everything', () => {
    const withChildren = (nodes: any[]): number =>
      nodes.reduce((n, x) => n + (x.children ? 1 + withChildren(x.children) : 0), 0);
    expect(withChildren([...NAVIGATION, ...EXTRA_SECTIONS])).toBeGreaterThan(3);
  });
});

describe('مفيش مدخلين بيروحوا نفس المكان', () => {
  it('never lists the same screen twice under two names', () => {
    // Two names for one screen is the most expensive kind of menu bug, because it is invisible:
    // somebody uses «جرد المخازن», somebody else uses «جرد عام», both are looking at the identical
    // page, and they spend an afternoon disagreeing about what the screen is for.
    //
    // Same PATH under two names is fine and common — «إذن إضافة» and «إذن صرف» are one screen with
    // different arguments. It is the full key, arguments and all, that must be unique.
    const seen = new Map<string, string[]>();
    allScreens().forEach((s) => {
      seen.set(s.key, [...(seen.get(s.key) ?? []), s.label]);
    });
    const duplicated = [...seen.entries()]
      .filter(([, labels]) => labels.length > 1)
      .map(([key, labels]) => `${key} ← ${labels.join(' / ')}`);
    expect(duplicated, 'نفس الشاشة بنفس الباراميترز تحت أكتر من اسم').toEqual([]);
  });

  it('never gives one screen two different names in the tab bar', () => {
    // The other direction: two labels for one key would also make the open tab's title depend on
    // which menu entry was clicked, so the same page reads differently on two people's screens.
    const byLabel = new Map<string, Set<string>>();
    allScreens().forEach((s) => {
      const set = byLabel.get(s.label) ?? new Set<string>();
      set.add(s.key);
      byLabel.set(s.label, set);
    });
    const ambiguous = [...byLabel.entries()]
      .filter(([, keys]) => keys.size > 1)
      .map(([label, keys]) => `«${label}» → ${[...keys].join(' , ')}`);
    expect(ambiguous, 'اسم واحد بيودّي لأكتر من شاشة').toEqual([]);
  });
});

describe('لوحة F4 بتوصل لكل حاجة القايمة بتوصّلها', () => {
  it('offers every menu entry by name', () => {
    // F4 is the keyboard's route to a screen, and it searches `allScreens()` by label. An entry
    // with no label, or one the search cannot match, is reachable by mouse and not by keyboard —
    // which quietly makes the keyboard the second-class way to work the system.
    const unreachable = allScreens().filter((s) => !s.label || !s.label.trim());
    expect(unreachable.map((s) => s.key), 'مدخل من غير اسم — مش هيبان في F4').toEqual([]);
  });

  it('reaches the new stocktake sheets, which is what the palette is for', () => {
    // A concrete case rather than only a shape check: these two moved screens this session, and a
    // rename that dropped them from the tree would otherwise pass every test above.
    const labels = allScreens().map((s) => s.label);
    expect(labels).toContain('جرد المخازن');
    expect(labels).toContain('جرد عام المخازن');
  });
});
