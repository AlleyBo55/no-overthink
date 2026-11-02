import { fetchUsr } from './api.js';

export async function greet(id) {
  const user = await fetchUsr(id);
  return `Hello, ${user.name}!`;
}
