import { getUser, listTeam, paginate } from './users.js';

export function handle(route, params = {}) {
  if (route === '/user') return getUser(Number(params.id));
  if (route === '/team') return listTeam(params.team);
  if (route === '/page') return paginate(Number(params.page), Number(params.size));
  return { error: 'not found' };
}

export function displayName(id) {
  const u = getUser(id);
  return u ? `${u.name} (${u.team})` : 'unknown';
}
