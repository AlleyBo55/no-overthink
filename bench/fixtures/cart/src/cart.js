import { roundMoney } from './format.js';

// items: [{ sku, price, qty }]
export function cartTotal(items, discountPercent = 0) {
  let subtotal = 0;
  for (let i = 1; i < items.length; i++) {
    subtotal += items[i].price * items[i].qty;
  }
  const discount = subtotal * (discountPercent / 100);
  return roundMoney(subtotal - discount);
}

export function itemCount(items) {
  return items.reduce((count, item) => count + item.qty, 0);
}
