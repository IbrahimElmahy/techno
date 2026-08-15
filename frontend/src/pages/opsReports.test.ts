/**
 * تقارير التشغيل والربحية — الأسماء والقايمة والصلاحيات لازم يفضلوا متطابقين.
 *
 * Same guard as `hrReports.test.ts`, for the same reason: the preset map lives in the page and the
 * `?view=` keys live in the menu, nothing in the type system connects them, and a typo opens the
 * screen on its default report under someone else's title. A report that silently shows the wrong
 * thing is the worst failure a report has.
 *
 * والنص التاني بتاع الملف عن الصلاحيات. نقطة نهاية واحدة بتجاوب سبع مواضيع بتتقفل **بالموضوع** مش
 * بالنقطة ([backend/src/api/ops_reports.py](../../../backend/src/api/ops_reports.py)) — فبند في
 * القايمة معروض لدور مالوش الصلاحية بيفتح على ٤٠٣، واللي بيتقري كشاشة مكسورة مش كصلاحية.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPORT_VIEWS as OPS_VIEWS } from './OpsReports';
import { REPORT_VIEWS as PROFIT_VIEWS } from './Profitability';
import { NAVIGATION, EXTRA_SECTIONS, isGroup, type NavScreen } from '../components/navigation';

const opsSrc = readFileSync(join(__dirname, 'OpsReports.tsx'), 'utf8');
const profitSrc = readFileSync(join(__dirname, 'Profitability.tsx'), 'utf8');

function flatten(nodes: any[]): NavScreen[] {
  return nodes.flatMap((n) => (isGroup(n) ? flatten(n.children) : [n]));
}

const screens = flatten([...(NAVIGATION as any[]), ...(EXTRA_SECTIONS as any[])]);
const opsEntries = screens.filter((s) => s.key.startsWith('/ops-reports'));
const profitEntries = screens.filter((s) => s.key.startsWith('/profitability'));

/** الأدوار اللي معاها كل صلاحية — نسخة من `rbac.py`، وهي الحد اللي البنود لازم تقف عنده. */
const HOLDERS: Record<string, string[]> = {
  loyalty: ['system_admin', 'after_sales_staff', 'viewer'],
  inspection: ['system_admin', 'branch_manager', 'sales_manager', 'after_sales_staff',
    'sales_rep', 'viewer'],
  voucher: ['system_admin', 'branch_manager', 'sales_manager', 'sales_rep', 'accountant',
    'viewer'],
  sales: ['system_admin', 'branch_manager', 'purchasing_manager', 'sales_manager', 'viewer'],
};

/** أي موضوع بيتقفل على أنهي صلاحية — نسخة من `_SUBJECT_CAPABILITY`. */
const SUBJECT_GATE: Record<string, string> = {
  points: 'loyalty', coupons: 'loyalty', coupon_receipts: 'loyalty',
  inspections: 'inspection', cheques: 'voucher',
  orders: 'sales', reservations: 'sales',
};

describe('أسماء تقارير التشغيل', () => {
  it('كل بند في القايمة بيفتح preset موجود', () => {
    expect(opsEntries.length).toBeGreaterThan(0);
    for (const entry of opsEntries) {
      const view = entry.key.split('view=')[1];
      expect(OPS_VIEWS[view], `«${entry.label}» بيفتح تقرير مش موجود: ${view}`).toBeTruthy();
    }
  });

  it('كل preset ليه بند في القايمة', () => {
    const opened = new Set(opsEntries.map((e) => e.key.split('view=')[1]));
    for (const key of Object.keys(OPS_VIEWS)) {
      expect(opened.has(key), `«${OPS_VIEWS[key].label}» مالوش بند في القايمة`).toBe(true);
    }
  });

  it('اسم البند هو نفسه اسم التقرير', () => {
    for (const entry of opsEntries) {
      const view = OPS_VIEWS[entry.key.split('view=')[1]];
      expect(view.label, `القايمة بتقول «${entry.label}» والتقرير اسمه «${view.label}»`)
        .toBe(entry.label);
    }
  });

  it('«ملخّص» مابيجيش من غير تجميع — الباك إند بيرفضه', () => {
    for (const v of Object.values(OPS_VIEWS)) {
      if (v.level === 'summary') {
        expect(v.groupBy, `«${v.label}» ملخّص من غير تجميع — هيرجع ٤٢٢`).not.toBe('none');
      }
    }
  });

  it('مفيش تقريرين بنفس المفاتيح تحت اسمين', () => {
    const seen = new Map<string, string>();
    for (const v of Object.values(OPS_VIEWS)) {
      const shape = `${v.subject}|${v.level}|${v.groupBy}|${v.dueWithinDays ?? ''}|${v.onlyOpen ?? ''}`;
      const twin = seen.get(shape);
      expect(twin, `«${v.label}» و«${twin}» نفس التقرير باسمين`).toBeUndefined();
      seen.set(shape, v.label);
    }
  });

  it('«بمحل الشراء» للمعاينات بس — الباقي مالهمش الحقل ده', () => {
    for (const v of Object.values(OPS_VIEWS)) {
      if (v.groupBy === 'shop') expect(v.subject).toBe('inspections');
    }
  });
});

describe('صلاحيات بنود التشغيل', () => {
  it('كل بند معروض لأدوار معاها صلاحية الموضوع', () => {
    for (const entry of opsEntries) {
      const view = OPS_VIEWS[entry.key.split('view=')[1]];
      const allowed = HOLDERS[SUBJECT_GATE[view.subject]];
      const extra = (entry.roles as string[]).filter((r) => !allowed.includes(r));
      expect(extra, `«${entry.label}» معروض لـ${extra.join('، ')} وهيرجعلهم ٤٠٣`).toEqual([]);
    }
  });

  it('كل موضوع من السبعة ليه اسم واحد على الأقل', () => {
    const covered = new Set(Object.values(OPS_VIEWS).map((v) => v.subject));
    expect(covered.size, 'موضوع مالوش أي تقرير — المحرك بيرد عليه ومحدش بيوصله')
      .toBe(Object.keys(SUBJECT_GATE).length);
  });
});

describe('الربحية', () => {
  it('البندين بيفتحوا preset موجود وباسمه', () => {
    expect(profitEntries.length).toBe(2);
    for (const entry of profitEntries) {
      const view = PROFIT_VIEWS[entry.key.split('view=')[1]];
      expect(view, `«${entry.label}» بيفتح تقرير مش موجود`).toBeTruthy();
      expect(view.label).toBe(entry.label);
    }
  });

  it('مقفولة على اللي بيقرا الدفاتر', () => {
    // الأرقام دي هي قايمة الدخل مقسومة — نفس حد ميزان المراجعة.
    const books = ['system_admin', 'branch_manager', 'accountant', 'viewer'];
    for (const entry of profitEntries) {
      const extra = (entry.roles as string[]).filter((r) => !books.includes(r));
      expect(extra, `«${entry.label}» معروض لـ${extra.join('، ')}`).toEqual([]);
    }
  });

  it('السطر بيتفتح على الحسابات اللي وراه', () => {
    // «المركز ده خسر ٢٠ ألف» مش آخر السؤال — «في إيه» هو.
    expect(profitSrc).toMatch(/onOpen: openBreakdown/);
    expect(profitSrc).toMatch(/profitability\/breakdown/);
  });

  it('بتقول لما «غير الموزّع» يبقى مخفي', () => {
    // الأجزاء لازم تجمع الكل، ولو اتخفى جزء لازم حاجة تقول.
    expect(profitSrc).toMatch(/الإجماليات دي أقل من قائمة الدخل/);
  });
});

describe('شاشة التشغيل', () => {
  it('بتحمّل مع أي فلتر — مفيش زرار «عرض»', () => {
    expect(opsSrc).toMatch(/useEffect\(\(\) => \{ load\(\); \}, \[params\]\)/);
  });

  it('الإجماليات بتتقرا من السيرفر مش بتتجمع من الصفحة', () => {
    expect(opsSrc).toMatch(/value=\{money\(totals\.amount\)\}/);
    expect(opsSrc, 'الكارت بيجمع الصفوف اللي على الشاشة').not.toMatch(/rows\.reduce/);
  });

  it('الملغي بيتعرض باهت وبيتقال إنه مش محسوب', () => {
    // نص الخاصية في الواجهة: الصف موجود، والرقم لأ — والاتنين لازم يبانوا.
    expect(opsSrc).toMatch(/row-muted/);
    expect(opsSrc).toMatch(/totals\?\.excluded/);
  });

  it('الملغي مابيبلعش مؤشر الكيبورد', () => {
    // `rowClassName` هنا بيحل محل اللي جاي من `kb.tableProps` مش بيتضاف عليه.
    expect(opsSrc).toMatch(/kb\.rowClassName\(r\)/);
  });

  it('«بيستحق خلال…» بيلغي مدى التواريخ', () => {
    // الاتنين نفس الفلتر؛ بعتهم مع بعض بيضيّق مرتين ويرجّع أقل من المطلوب.
    expect(opsSrc).toMatch(/if \(dueWithin\) p\.due_within_days = dueWithin;\s*\n\s*else if \(range\)/);
  });

  it('٤٠٣ بتتعرض كإجابة مش كعطل', () => {
    expect(opsSrc).toMatch(/status === 403/);
    expect(opsSrc).toMatch(/setDenied\(true\)/);
  });
});
