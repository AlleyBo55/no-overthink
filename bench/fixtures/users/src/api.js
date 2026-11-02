const users = new Map([
  [1, { id: 1, name: 'Ada' }],
  [2, { id: 2, name: 'Linus' }],
]);

export async function fetchUsr(id) {
  const user = users.get(id);
  if (!user) throw new Error(`User ${id} not found`);
  return user;
}

export async function listUsers() {
  return [...users.values()];
}
