export function summarize(orders) {
  const counts = orders.map((order) => order.items.length);
  const total = counts.reduce((sum, n) => sum + n, 0);
  return `${orders.length} orders, ${total} items`;
}
