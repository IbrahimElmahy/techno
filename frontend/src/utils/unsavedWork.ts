export function fingerprint(value: unknown): string {
  const norm = (v: any): any => {
    if (v === undefined || v === null || v === '') return null;
    if (Array.isArray(v)) return v.map(norm);
    if (typeof v === 'object') {
      const out: Record<string, any> = {};
      for (const k of Object.keys(v).sort()) {
        const n = norm(v[k]);
        if (n !== null) out[k] = n;
      }
      return out;
    }
    if (typeof v === 'number') return Number(v.toFixed(4));
    if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) {
      return Number(Number(v).toFixed(4));
    }
    return v;
  };
  return JSON.stringify(norm(value));
}

export type LeaveVerdict =
  | 'silent'
  | 'confirm-new'
  | 'confirm-edit';

export function verdictOnLeave(opts: {
  readOnly: boolean;
  savedDocument: boolean;
  now: string;
  whenOpened: string | null;
  hasWork: boolean;
}): LeaveVerdict {
  if (opts.readOnly) return 'silent';
  if (opts.savedDocument) {
    if (opts.whenOpened === null) return 'confirm-edit';
    return opts.now === opts.whenOpened ? 'silent' : 'confirm-edit';
  }
  return opts.hasWork ? 'confirm-new' : 'silent';
}
