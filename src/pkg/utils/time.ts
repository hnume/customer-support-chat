export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

export const toIso = (d: Date | string | null | undefined): string | null =>
  d == null ? null : d instanceof Date ? d.toISOString() : new Date(d).toISOString();
