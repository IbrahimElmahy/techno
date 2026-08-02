import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { allScreens } from './navigation';

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
