export const COMPANY = {
  nameAr: 'تكنو ثيرم',
  nameEn: 'TechnoTherm — German Technology',
  activity: 'أنظمة السباكة والتغذية',
  address: 'قطعة 676 امتداد المنطقة الصناعية السادسة — مدينة السادس من أكتوبر',
  phones: ['01062240047', '01020275910'],
  taxId: '',
  commercialRegister: '',
  email: '',
  website: '',
};

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
