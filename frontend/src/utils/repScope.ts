export function customersOfRep<T extends { rep_id?: number | null }>(
  customers: T[], repId?: number | null,
): T[] {
  return repId ? customers.filter((c) => c.rep_id === repId) : customers;
}

export function customerFitsRep<T extends { id: number; rep_id?: number | null }>(
  customers: T[], customerId?: number | null, repId?: number | null,
): boolean {
  if (!customerId || !repId) return true;
  const c = customers.find((x) => x.id === customerId);
  return !c || c.rep_id === repId;
}
