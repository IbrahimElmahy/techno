/**
 * إذن التحويل — صفحة واحدة: بتتكتب فيها، وبتتعدّل فيها، وبتتعتمد منها.
 *
 * Approving used to happen in a modal that opened over the list: a read-only sheet with an اعتماد
 * button. So the screen that WROTE a permit and the screen that DECIDED on it were two different
 * things, and an approver who found a wrong quantity corrected it through a popup that looked
 * nothing like the form it was typed in.
 *
 * There is one document page now. It opens empty for a new permit and filled for an existing one,
 * and the decision is taken on it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'Transfers.tsx'), 'utf8');

describe('الاعتماد بقى جوّه المستند', () => {
  it('ورقة المراجعة اتشالت خالص', () => {
    // Two ways to approve is one way too many, and the one that survives is the document. A
    // leftover `reviewing` state is a second, unreachable path that would drift from this one.
    expect(src).not.toMatch(/setReviewing/);
    expect(src).not.toMatch(/open=\{!!reviewing\}/);
  });

  it('السطر بيفتح المستند نفسه، مش نافذة عرض', () => {
    expect(src).toMatch(/onOpen: \(t\) => openTransfer\(t\)/);
  });

  it('و«اعتماد» من القايمة بيفتح المستند برضه', () => {
    expect(src).toMatch(/onClick=\{\(\) => openTransfer\(record\)\}/);
  });

  it('اعتماد ورفض على صفحة المستند — فوق وتحت', () => {
    expect(src).toMatch(/key: 'approve', label: 'اعتماد'/);
    expect(src).toMatch(/key: 'reject', label: 'رفض'/);
    expect(src).toMatch(/اعتماد الإذن/);
  });

  it('ومش بيبانوا غير لما يكون فيه سؤال بجد', () => {
    // A closed permit has nothing to decide, and somebody without the capability is not being
    // asked. Showing the buttons anyway teaches people to press things that refuse.
    expect(src).toMatch(/editing && pending && canApprove/);
    expect(src).toMatch(/editing\.status === 'pending' && canApprove/);
  });
});

describe('التعديل من جوّه نفس الصفحة', () => {
  it('الكميات بتتعدّل على المستند المفتوح', () => {
    expect(src).toMatch(/if \(editing\) await refreshEditing\(editing\.id\)/);
  });

  it('الكمية بتترسل لما تخلص كتابة، مش مع كل رقم', () => {
    // «12» typed a digit at a time would otherwise send 1 and then 12, and the 1 is a real edit
    // somebody else could read off the document.
    expect(src).toMatch(/draftQty/);
    expect(src).toMatch(/onPressEnter=\{\(\) => setReviewLineQty/);
    expect(src).toMatch(/onBlur=\{\(\) => setReviewLineQty/);
    // …and never read back out of the DOM at blur time.
    expect(src).not.toMatch(/Number\(\(e\.target as any\)\.value\)/);
  });

  it('المسودّة مابتعديش من إذن للي بعده', () => {
    // Carrying it over would show a quantity nobody typed on that document.
    expect(src).toMatch(/setEditing\(t\);\s*\n\s*setDraftQty\(\{\}\)/);
  });

  it('المصدر والوجهة مقفولين على إذن محفوظ', () => {
    // «from here to there» IS the permit; changing it is a different permit.
    expect((src.match(/disabled=\{!!editing\}/g) || []).length).toBe(2);
  });

  it('الإذن المقفول مايتعدلش', () => {
    // Approval already posted movements across two warehouses. The quantity is an input only
    // while the permit is still a question; after that it is plain text.
    expect(src).toMatch(/editing\.status === 'pending' && !r\._header \? \(/);
    expect(src).toMatch(/\) : <b>\{qty\(Number\(v\)\)\}<\/b>\)/);
    expect(src).toMatch(/الإذن ده اتقفل خلاص/);
  });
});

describe('المستند بيقول اللي جاي', () => {
  it('بيقول إنه مستني اعتماد', () => {
    // The approver arrives to answer a question and should not infer it from which buttons are lit.
    expect(src).toMatch(/الإذن ده لسه مستني الاعتماد/);
  });

  it('وبيفرّق بين اللي يقدر يعتمد واللي لأ', () => {
    expect(src).toMatch(/لسه مستني اعتماد مدير المخزن/);
  });

  it('والمتاح في المصدر بيبقى أحمر لو الكمية أكتر منه', () => {
    // Said before اعتماد is pressed, rather than by the negative-stock guard afterwards.
    expect(src).toMatch(/const short = Number\(r\.quantity \|\| 0\) > have/);
  });
});

describe('الإذن القديم بيعرض بياناته برضه', () => {
  it('بيقرا الصنف من المستند نفسه لو مفيش سطور', () => {
    // A transfer used to move ONE item, stored as `item_id` + `quantity` on the document; the
    // lines table came later. Three of the four permits on this database predate it, so a screen
    // reading only `lines` renders an EMPTY document — «البيانات مش ظاهرة جوّه الإذن».
    expect(src).toMatch(/const docLines = \(t: TransferRecord\)/);
    expect(src).toMatch(/if \(t\.item_id\)/);
    expect(src).toMatch(/dataSource=\{docLines\(editing\)\}/);
  });

  it('والعدّادات تحت بتقرا من نفس المكان', () => {
    // Reading the table from one source and the totals from another is how «عدد الأصناف: 0» ends
    // up under a table with a row in it.
    expect(src).toMatch(/\{editing \? docLines\(editing\)\.length : lines\.length\}/);
    expect(src).toMatch(/\? docLines\(editing\)\.reduce\(/);
  });

  it('والسطر المقروء من المستند مالوش تعديل ولا حذف', () => {
    // There is no line row behind it — nothing to PATCH and nothing to DELETE. Offering the
    // controls anyway would be offering an edit that cannot land.
    expect(src).toMatch(/_header: true/);
    expect(src).toMatch(/'pending' && !r\._header/);
    expect(src).toMatch(/\(r\._header \? null : \(/);
  });

  it('ومفيش اعتذار مكان الإجابة', () => {
    // The old sheet said «إذن قديم — الصنف مكتوب على المستند نفسه» in the place where the item
    // should have been. It IS on the document; read it from there and show it. Checked on the
    // rendered emptyText rather than the file, so explaining the history in a comment is fine.
    const emptyText = (src.match(/emptyText: [^}]+/) || [''])[0];
    expect(emptyText).not.toMatch(/إذن قديم/);
    expect(emptyText).toMatch(/ارفضه بدل ما تعتمده/);
  });
});
