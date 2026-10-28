import type { CurrentUser } from '../types';

type NamedUser=Pick<CurrentUser,'firstName'|'lastName'|'email'>;

/** Versioned photo URL, so a new photo is never served from cache. */
export function avatarUrl(user:Pick<CurrentUser,'id'|'avatarVersion'>){
  return user.avatarVersion?`/api/users/${user.id}/avatar?v=${user.avatarVersion}`:null;
}

export function displayName(user:NamedUser){
  return [user.firstName,user.lastName].filter(Boolean).join(' ')||user.email;
}

export function initialsOf(user:NamedUser){
  const fromName=[user.firstName,user.lastName].map(part=>part?.trim()[0]).filter(Boolean).join('');
  return (fromName||user.email[0]||'?').toUpperCase();
}
