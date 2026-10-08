const original = Number.prototype.toLocaleString;

// eslint-disable-next-line no-extend-native
Number.prototype.toLocaleString = function toLocaleString(
  this: number,
  locales?: string | string[],
  options?: Intl.NumberFormatOptions,
) {
  return original.call(this, locales, { useGrouping: false, ...(options || {}) });
};

export {};
