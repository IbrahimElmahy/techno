const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة',
  'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر',
  'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة',
  'سبعمائة', 'ثمانمائة', 'تسعمائة'];

const SCALES: [string, string, string][] = [
  ['', '', ''],
  ['ألف', 'ألفان', 'آلاف'],
  ['مليون', 'مليونان', 'ملايين'],
  ['مليار', 'ملياران', 'مليارات'],
];

function under1000(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) parts.push(HUNDREDS[h]);
  if (rest) {
    if (rest < 20) parts.push(ONES[rest]);
    else {
      const unit = rest % 10;
      const ten = Math.floor(rest / 10);
      parts.push(unit ? `${ONES[unit]} و${TENS[ten]}` : TENS[ten]);
    }
  }
  return parts.join(' و');
}

function scaled(count: number, level: number): string {
  const [one, two, many] = SCALES[level];
  if (level === 0) return under1000(count);
  if (count === 1) return one;
  if (count === 2) return two;
  if (count <= 10) return `${under1000(count)} ${many}`;
  return `${under1000(count)} ${one}`;
}

export function integerToArabicWords(value: number): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return 'صفر';
  const groups: number[] = [];
  while (n > 0) {
    groups.push(n % 1000);
    n = Math.floor(n / 1000);
  }
  const parts: string[] = [];
  for (let level = groups.length - 1; level >= 0; level -= 1) {
    if (groups[level]) parts.push(scaled(groups[level], level));
  }
  return parts.join(' و');
}

export function amountToArabicWords(amount: number | string, currency = 'جنيه مصري'): string {
  const value = Number(amount || 0);
  const pounds = Math.floor(Math.abs(value));
  const piastres = Math.round((Math.abs(value) - pounds) * 100);
  const parts = [`${integerToArabicWords(pounds)} ${currency}`];
  if (piastres > 0) parts.push(`${integerToArabicWords(piastres)} قرش`);
  return `فقط ${parts.join(' و')} لا غير`;
}
