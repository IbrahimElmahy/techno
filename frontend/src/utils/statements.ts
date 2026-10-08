import { normalizeAr } from './arabicSort';

export interface HasStatements {
  statement1?: string | null;
  statement2?: string | null;
  statement3?: string | null;
}

const filledOf = (r: HasStatements | null | undefined): string[] =>
  r ? [r.statement1, r.statement2, r.statement3]
    .map((x) => (x || '').trim()).filter(Boolean) : [];

export const statementText = (r: HasStatements | null | undefined): string =>
  filledOf(r).join(' · ');

export const statementMeta = (r: HasStatements | null | undefined): [string, string][] => {
  const filled = filledOf(r);
  return filled.map((x, i) => [filled.length > 1 ? `البيان ${i + 1}` : 'البيان', x]);
};

export const matchesStatement = (r: HasStatements, needle: unknown): boolean =>
  normalizeAr(statementText(r)).includes(normalizeAr(String(needle ?? '')));
