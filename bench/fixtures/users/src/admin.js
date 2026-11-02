import { fetchUsr, listUsers } from './api.js';

export async function describeUser(id) {
  const user = await fetchUsr(id);
  return `${user.id}: ${user.name}`;
}

export async function userCount() {
  return (await listUsers()).length;
}
