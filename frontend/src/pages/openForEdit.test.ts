import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * الضغط على مستند يوديك تعديله، مش «عرض».
 *
 * «الغي عرض المستند وخليها تدخلني على تعديل على طول» was asked once and answered three times,
 * because the read-only sheet lived in three places and retiring the BUTTON called «عرض المستند»
 * only removed one of them:
 *
 *  1. the button on `DocumentLink` — retired first, and the reason the rest looked done;
 *  2. the row on the invoices register, which still opened the sheet;
 *  3. the row on كشف حساب العميل and المورد, which opened a different read-only sheet again.
 *
 * Each was a stop everybody passed through on the way somewhere else. This holds all three shut.
 */

const PAGES = __dirname;
const read = (f: string) => readFileSync(join(PAGES, f), 'utf8');

describe('المستند يتفتح للتعديل', () => {
  it('the invoices register opens the edit path, not the view sheet', () => {
    const src = read('Invoices.tsx');
    const onRow = src.slice(src.indexOf('onRow={(record)'), src.indexOf('onRow={(record)') + 260);
    expect(onRow).toMatch(/handleEditInvoice/);
  });

  it('and still gives the sheet to somebody who may not edit', () => {
    // A row that does nothing for a viewer reads as broken. The permission decides which of the
    // two they get, not whether the click works.
    const src = read('Invoices.tsx');
    const onRow = src.slice(src.indexOf('onRow={(record)'), src.indexOf('onRow={(record)') + 260);
    expect(onRow).toMatch(/canEditInvoice/);
    expect(onRow).toMatch(/openDetail/);
  });

  it.each(['CustomerProfile.tsx', 'SupplierProfile.tsx'])(
    '%s opens the document behind a statement line', (file) => {
      const src = read(file);
      // The statement has carried `doc_kind` and `doc_id` all along; these screens threw them away
      // and opened `/records/{kind}/{id}` instead.
      expect(src).toMatch(/r\.doc_kind && r\.doc_id/);
      expect(src).toMatch(/openDoc\(r\.doc_kind, r\.doc_id\)/);
    },
  );

  it.each(['CustomerProfile.tsx', 'SupplierProfile.tsx'])(
    '%s still opens the sheet for a line with no document', (file) => {
      // A manual journal entry and an opening balance have nowhere else to go, and a dead click is
      // worse than a plain answer.
      expect(read(file)).toMatch(/openRecord\(kind, kind === 'entry'/);
    },
  );

  it('has no «عرض المستند» button left anywhere', () => {
    // The phrase as something RENDERED, not as prose. It still appears in the comment that records
    // why the button went, and a check that cannot tell an explanation from a label would force
    // the next person to delete the explanation.
    const src = readFileSync(join(PAGES, '..', 'components', 'DocumentLink.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*/g, '');
    expect(src).not.toMatch(/عرض المستند/);
  });
});
