const USERS = [
  { id: 1, name: 'Ada', team: 'platform' },
  { id: 2, name: 'Grace', team: 'platform' },
  { id: 3, name: 'Linus', team: 'kernel' },
  { id: 4, name: 'Margaret', team: 'flight' },
  { id: 5, name: 'Dennis', team: 'kernel' },
];

export function getUser(id) {
  return USERS.find(u => u.id === id) ?? null;
}

export function listTeam(team) {
  return USERS.filter(u => u.team === team).map(u => u.name);
}

// Returns page `page` (1-based) of `size` users.
export function paginate(page, size) {
  const start = page * size;
  return USERS.slice(start, start + size);
}

export function initials(user) {
  return user.name.split(' ').map(p => p[0]).join('').toUpperCase();
}
