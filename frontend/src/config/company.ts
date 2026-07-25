/**
 * The company's identity as it appears on every document and screen header.
 *
 * Single source of truth — the printed letterhead, the on-screen invoice and the voucher all
 * read from here, so a change of address or phone number happens once.
 */
export const COMPANY = {
  nameAr: 'تكنو ثيرم',
  nameEn: 'TechnoTherm — German Technology',
  activity: 'أنظمة السباكة والتغذية',
  address: 'قطعة 676 امتداد المنطقة الصناعية السادسة — مدينة السادس من أكتوبر',
  phones: ['01062240047', '01020275910'],
  // Fill these in when the client provides them; empty values are simply not printed.
  taxId: '',
  commercialRegister: '',
  email: '',
  website: '',
};

/** The address/phone lines under the company name, skipping anything not filled in. */
export function companyLines(): string[] {
  return [
    COMPANY.nameEn,
    COMPANY.activity,
    COMPANY.address,
    `ت: ${COMPANY.phones.join(' - ')}`,
    COMPANY.taxId ? `بطاقة ضريبية: ${COMPANY.taxId}` : '',
    COMPANY.commercialRegister ? `سجل تجاري: ${COMPANY.commercialRegister}` : '',
    COMPANY.email,
  ].filter(Boolean);
}
