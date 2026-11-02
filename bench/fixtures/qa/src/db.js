const orders = new Map([
  [1, { id: 1, total: 25.5 }],
  [2, { id: 2, total: 8 }],
]);

export async function getOrder(id) {
  return orders.get(id) ?? null;
}
