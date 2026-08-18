export function computeOrderTotal(
  lines: ReadonlyArray<{ quantity: number; unitPrice: number; taxRate: number }>,
): number {
  let goods = 0;
  let taxes = 0;
  for (const line of lines) {
    const extended = line.quantity * line.unitPrice;
    goods += extended;
    taxes += extended * line.taxRate;
    if (line.quantity >= 25) {
      goods -= extended * 0.08;
    } else if (line.quantity >= 10) {
      goods -= extended * 0.03;
    }
  }
  const freight = goods > 250 ? 0 : goods > 100 ? 8.5 : 15;
  const coupon = goods > 400 ? 25 : 0;
  return goods + taxes + freight - coupon;
}
