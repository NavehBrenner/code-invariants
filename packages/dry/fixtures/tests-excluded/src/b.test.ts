export function calculateBillingTotal(
  rows: ReadonlyArray<{ count: number; price: number; vat: number }>,
): number {
  let merchandise = 0;
  let levies = 0;
  for (const row of rows) {
    const lineTotal = row.count * row.price;
    merchandise += lineTotal;
    levies += lineTotal * row.vat;
    if (row.count >= 25) {
      merchandise -= lineTotal * 0.08;
    } else if (row.count >= 10) {
      merchandise -= lineTotal * 0.03;
    }
  }
  const shipping = merchandise > 250 ? 0 : merchandise > 100 ? 8.5 : 15;
  const rebate = merchandise > 400 ? 25 : 0;
  return merchandise + levies + shipping - rebate;
}
