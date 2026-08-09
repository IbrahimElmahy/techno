/**
 * الصفحة الرئيسية — بتقول فيه إيه غلط.
 *
 * The home screen was a placeholder. What usually fills that space is a wall of totals — sales
 * this month, customer count, a chart — numbers nobody acts on, on the one screen everybody opens
 * first. This asks the only question worth putting there, and the rules pinned below are the ones
 * that decide whether it gets read or ignored after week one.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..');
const page = readFileSync(join(SRC, 'pages', 'Dashboard.tsx'), 'utf8');
const routes = readFileSync(join(SRC, 'components', 'PageRoutes.tsx'), 'utf8');

describe('الصفحة الرئيسية بقت الفحص', () => {
  it('مش Placeholder', () => {
    expect(routes).toMatch(/path="\/dashboard" element=\{<Dashboard \/>\}/);
    expect(routes).not.toMatch(/path="\/dashboard"[^>]*Placeholder/);
  });

  it('بتقرا الفحص من نداء واحد', () => {
    // Eleven checks over eleven endpoints would be eleven round trips to draw one page, and would
    // leave it half-answered whenever one of them failed.
    expect(page).toMatch(/'\/api\/v1\/reports\/health'/);
    expect((page.match(/api\.get/g) || []).length).toBe(1);
  });
});

describe('القواعد اللي بتخلي الصفحة تتقرا', () => {
  it('«مفيش حاجة غلط» إجابة مكتوبة، مش صفحة فاضية', () => {
    // Otherwise a healthy system and a broken screen look identical — and healthy is the common
    // day, so the ambiguity would be the normal experience.
    expect(page).toMatch(/data\.clean/);
    expect(page).toMatch(/مفيش حاجة غلط/);
  });

  it('فشل الفحص شكله مختلف عن نظام سليم', () => {
    // Rendering «كله تمام» because the request died is the worst thing this screen could do.
    expect(page).toMatch(/setFailed\(true\)/);
    expect(page).toMatch(/الفحص نفسه مانجحش/);
  });

  it('كل نتيجة ليها صفحة تروحلها', () => {
    // A count with nowhere to click is a complaint, not a finding.
    expect(page).toMatch(/navigate\(issue\.link\)/);
  });

  it('كل نتيجة بتقول هي مكلفاك إيه مش بس عددها', () => {
    expect(page).toMatch(/issue\.hint/);
  });

  it('العيّنة المقصوصة مابتتقريش على إنها الكل', () => {
    // Five samples under a count of 376 must say so, or the page understates every finding.
    expect(page).toMatch(/issue\.count > issue\.samples\.length/);
  });

  it('الخطورة مشروحة بالكلام مش بلون بس', () => {
    // «٢ خطر» means nothing on its own; a colour even less.
    expect(page).toMatch(/note: 'فيه رقم في النظام بقى غلط'/);
  });
});
