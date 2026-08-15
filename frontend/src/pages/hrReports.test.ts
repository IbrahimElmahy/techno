/**
 * تقارير الموارد البشرية — الأسماء والقايمة والصلاحيات لازم يفضلوا متطابقين.
 *
 * The screen is one engine behind nineteen names, and the names live in two places: the preset map
 * in the page and the menu entries that open them. Nothing in the type system connects the two, so
 * a `?view=` typo in the menu opens the screen on its default report under someone else's title —
 * a report that silently shows the wrong thing, which is the worst failure a report can have.
 *
 * The permission half matters as much. `salary.view` is granted to system_admin and accountant
 * only ([backend/src/auth/rbac.py](../../../backend/src/auth/rbac.py)), and the four money
 * subjects are gated on it inside the endpoint. A menu entry for one of those shown to a
 * branch_manager opens onto a 403 — which reads as a broken screen, not as a permission.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPORT_VIEWS } from './HrReports';
import { NAVIGATION, isGroup, type NavScreen } from '../components/navigation';

const src = readFileSync(join(__dirname, 'HrReports.tsx'), 'utf8');

/** كل شاشة في القايمة، مهما كانت جوّه كام مجموعة. */
function flatten(nodes: any[]): NavScreen[] {
  return nodes.flatMap((n) => (isGroup(n) ? flatten(n.children) : [n]));
}

const screens = flatten(NAVIGATION as any[]);
const hrEntries = screens.filter((s) => s.key.startsWith('/hr-reports'));

/** المواضيع اللي الباك إند بيطلب عليها `salary.view` — نسخة من `_MONEY_SUBJECTS`. */
const MONEY = ['payroll', 'cost', 'advance', 'adjustment'];
/** الأدوار اللي فعلاً معاها `salary.view`. */
const SALARY_ROLES = ['system_admin', 'accountant'];

describe('أسماء التقارير', () => {
  it('كل بند في القايمة بيفتح preset موجود', () => {
    expect(hrEntries.length).toBeGreaterThan(0);
    for (const entry of hrEntries) {
      const view = entry.key.split('view=')[1];
      expect(REPORT_VIEWS[view], `«${entry.label}» بيفتح تقرير مش موجود: ${view}`).toBeTruthy();
    }
  });

  it('كل preset ليه بند في القايمة', () => {
    const opened = new Set(hrEntries.map((e) => e.key.split('view=')[1]));
    for (const key of Object.keys(REPORT_VIEWS)) {
      expect(opened.has(key), `التقرير «${REPORT_VIEWS[key].label}» مالوش بند في القايمة`).toBe(true);
    }
  });

  it('اسم البند هو نفسه اسم التقرير', () => {
    // اللي بيدوّر على «كشف حضور وانصراف» في القايمة لازم يلاقي التبويب مفتوح بنفس الاسم.
    for (const entry of hrEntries) {
      const view = REPORT_VIEWS[entry.key.split('view=')[1]];
      expect(view.label, `القايمة بتقول «${entry.label}» والتقرير اسمه «${view.label}»`)
        .toBe(entry.label);
    }
  });

  it('مفيش تقريرين بنفس المفاتيح تحت اسمين', () => {
    const seen = new Map<string, string>();
    for (const [key, v] of Object.entries(REPORT_VIEWS)) {
      const shape = `${v.subject}|${v.level}|${v.groupBy}`;
      const twin = seen.get(shape);
      expect(twin, `«${v.label}» و«${twin}» نفس التقرير باسمين`).toBeUndefined();
      seen.set(shape, v.label);
    }
    expect(seen.size).toBe(Object.keys(REPORT_VIEWS).length);
  });

  it('«ملخّص» مابيجيش من غير تجميع — الباك إند بيرفضه', () => {
    for (const v of Object.values(REPORT_VIEWS)) {
      if (v.level === 'summary') {
        expect(v.groupBy, `«${v.label}» ملخّص من غير تجميع — هيرجع ٤٢٢`).not.toBe('none');
      }
    }
  });
});

describe('الصلاحيات', () => {
  it('التقارير اللي فيها مبالغ مقفولة على اللي معاه salary.view', () => {
    const money = hrEntries.filter((e) => MONEY.includes(
      REPORT_VIEWS[e.key.split('view=')[1]].subject));
    expect(money.length, 'مالقاش أي تقرير مبالغ — الاختبار بيقرا حاجة اتغيّرت').toBe(7);
    for (const entry of money) {
      expect(entry.roles, `«${entry.label}» مفتوح لدور مالوش salary.view`)
        .toEqual(SALARY_ROLES);
    }
  });

  it('مفيش دور برّه salary.view شايف بند مبالغ', () => {
    // مدير الفرع بيشوف الحضور والأجازات، ومابيشوفش رقم حد.
    const visible = hrEntries.filter((e) => (e.roles as string[]).includes('branch_manager'));
    for (const entry of visible) {
      const subject = REPORT_VIEWS[entry.key.split('view=')[1]].subject;
      expect(MONEY, `مدير الفرع شايف «${entry.label}» وهيرجعله ٤٠٣`).not.toContain(subject);
    }
  });
});

describe('الشاشة', () => {
  it('بتحمّل مع أي فلتر — مفيش زرار «عرض»', () => {
    expect(src).toMatch(/useEffect\(\(\) => \{ load\(\); \}, \[params\]\)/);
  });

  it('الإجماليات بتتقرا من السيرفر مش بتتجمع من الصفحة', () => {
    // A page-level sum under «إجمالي المبلغ» is the answer for the first five hundred rows, and
    // nothing on screen would say so. The card must read `totals`, never `rows`.
    expect(src).toMatch(/value=\{money\(totals\.amount\)\}/);
    expect(src, 'الكارت بيجمع الصفوف اللي على الشاشة').not.toMatch(/rows\.reduce/);
  });

  it('بتقول إن المعروض مقصوص', () => {
    expect(src).toMatch(/page\?\.truncated/);
  });

  it('٤٠٣ بتتعرض كإجابة مش كعطل', () => {
    expect(src).toMatch(/status === 403/);
    expect(src).toMatch(/setDenied\(true\)/);
  });
});
