export interface Coded { id: number; code?: string | null; name: string }

export function codedOption<T extends Coded>(x: T, suffix = '') {
  return {
    value: x.id,
    label: `${x.name}${suffix}`,
    search: x.code || '',
  };
}

export function codedOptions<T extends Coded>(list: T[], suffix?: (x: T) => string) {
  return list.map((x) => codedOption(x, suffix ? suffix(x) : ''));
}
