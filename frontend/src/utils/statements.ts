import { normalizeAr } from './arabicSort';

/**
 * «البيان» — السطر الحر اللي المستخدم بيكتبه على أي مستند.
 *
 * كل مستند عنده من خانة لتلاتة (`statement1..3`): الفواتير ومردوداتها تلاتة زي a5، والباقي
 * خانة واحدة. الدوال هنا عشان كل شاشة تعرضه وتطبعه وتدوّر فيه بنفس الشكل — من غير ما كل
 * شاشة تكتب نسختها وتختلف واحدة عن التانية في «البيان ١» ولا «البيان».
 */
export interface HasStatements {
  statement1?: string | null;
  statement2?: string | null;
  statement3?: string | null;
}

const filledOf = (r: HasStatements | null | undefined): string[] =>
  r ? [r.statement1, r.statement2, r.statement3]
    .map((x) => (x || '').trim()).filter(Boolean) : [];

/** البيانات المليانة في سطر واحد — للعمود في السجل والتصدير. */
export const statementText = (r: HasStatements | null | undefined): string =>
  filledOf(r).join(' · ');

/**
 * البيانات على الورقة كأزواج (عنوان، قيمة).
 *
 * الخانة الفاضية مابتطبعش: عنوان من غير قيمة على الورقة بيتقري «نسيوا يكتبوه». ولما في
 * أكتر من خانة مليانة بتترقّم عشان اللي بيقرا يعرف إنهم تلاتة مش سطر واحد اتكسر.
 */
export const statementMeta = (r: HasStatements | null | undefined): [string, string][] => {
  const filled = filledOf(r);
  return filled.map((x, i) => [filled.length > 1 ? `البيان ${i + 1}` : 'البيان', x]);
};

/**
 * فلتر «البيان» في السجل — جزء من الكلام في أي خانة، بنفس توحيد الهمزات والتاء المربوطة
 * اللي في مربع البحث. «فاتوره» لازم تلاقي «فاتورة» هنا زي ما بتلاقيها فوق.
 */
export const matchesStatement = (r: HasStatements, needle: unknown): boolean =>
  normalizeAr(statementText(r)).includes(normalizeAr(String(needle ?? '')));
