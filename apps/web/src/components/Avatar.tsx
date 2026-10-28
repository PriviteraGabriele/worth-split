import type { CSSProperties,ReactNode } from 'react';
import { avatarUrl,initialsOf } from '../lib/user';
import type { CurrentUser } from '../types';

type AvatarUser=Pick<CurrentUser,'id'|'email'|'firstName'|'lastName'|'avatarVersion'>;

/** Profile photo, or the initials when the account has none. */
export function Avatar({user,className,style,children}:{user:AvatarUser;className?:string;style?:CSSProperties;children?:ReactNode}){
  const src=avatarUrl(user);
  return <span className={`${className??''}${src?' has-photo':''}`} style={style}>
    {src?<img src={src} alt="" decoding="async"/>:initialsOf(user)}
    {children}
  </span>;
}
