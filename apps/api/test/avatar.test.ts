import Fastify from 'fastify';
import { beforeEach,describe,expect,it,vi } from 'vitest';

const {queryMock,session}=vi.hoisted(()=>({queryMock:vi.fn(),session:{userId:'00000000-0000-4000-8000-000000000002',role:'user'}}));
vi.mock('../src/db/pool.js',()=>({pool:{query:queryMock,connect:vi.fn()}}));
vi.mock('../src/auth.js',async()=>{
  const actual=await vi.importActual<typeof import('../src/auth.js')>('../src/auth.js');
  return {...actual,requireAuth:async(request:{userId:string;userRole:string})=>{request.userId=session.userId;request.userRole=session.role}};
});

import { AVATAR_MAX_BYTES,AvatarError,parseAvatarDataUrl } from '../src/services/avatar.js';
import { registerProfileRoutes } from '../src/routes/profile.js';

const jpeg=Buffer.from([0xff,0xd8,0xff,0xe0,0x00,0x10,0x4a,0x46,0x49,0x46]);
const png=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00,0x00]);
const dataUrl=(mime:string,bytes:Buffer)=>`data:${mime};base64,${bytes.toString('base64')}`;
const otherUser='00000000-0000-4000-8000-000000000003';

async function createApp(){
  const app=Fastify();registerProfileRoutes(app);await app.ready();
  return app;
}

describe('avatar parsing',()=>{
  it('accepts raster images whose bytes match the declared type',()=>{
    expect(parseAvatarDataUrl(dataUrl('image/jpeg',jpeg))).toEqual({mime:'image/jpeg',bytes:jpeg});
    expect(parseAvatarDataUrl(dataUrl('image/png',png)).mime).toBe('image/png');
  });

  it('refuses SVG, mismatched bytes and oversized files',()=>{
    expect(()=>parseAvatarDataUrl(dataUrl('image/svg+xml',Buffer.from('<svg/>')))).toThrow(AvatarError);
    expect(()=>parseAvatarDataUrl(dataUrl('image/png',jpeg))).toThrow('AVATAR_INVALID');
    const huge=Buffer.concat([jpeg,Buffer.alloc(AVATAR_MAX_BYTES)]);
    expect(()=>parseAvatarDataUrl(dataUrl('image/jpeg',huge))).toThrow('AVATAR_TOO_LARGE');
  });
});

describe('avatar routes',()=>{
  beforeEach(()=>{
    queryMock.mockReset();
    session.userId='00000000-0000-4000-8000-000000000002';session.role='user';
  });

  it('stores the photo for the current user only',async()=>{
    const app=await createApp();
    queryMock.mockResolvedValueOnce({rows:[{id:session.userId,avatarVersion:'1792774000000'}]});

    const response=await app.inject({method:'PUT',url:'/api/profile/avatar',payload:{image:dataUrl('image/jpeg',jpeg)}});

    expect(response.statusCode).toBe(200);
    expect(response.json().user.avatarVersion).toBe('1792774000000');
    expect(String(queryMock.mock.calls[0]?.[0])).toContain('WHERE id=$3');
    expect(queryMock.mock.calls[0]?.[1]).toEqual([jpeg,'image/jpeg',session.userId]);
    await app.close();
  });

  it('rejects a file that is not a supported image without touching the database',async()=>{
    const app=await createApp();
    const response=await app.inject({method:'PUT',url:'/api/profile/avatar',payload:{image:dataUrl('image/png',Buffer.from('not an image'))}});
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({error:'AVATAR_INVALID'});
    expect(queryMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('removes the photo',async()=>{
    const app=await createApp();
    queryMock.mockResolvedValueOnce({rows:[{id:session.userId,avatarVersion:null}]});
    const response=await app.inject({method:'DELETE',url:'/api/profile/avatar'});
    expect(response.statusCode).toBe(200);
    expect(String(queryMock.mock.calls[0]?.[0])).toContain('avatar=NULL');
    await app.close();
  });

  it('serves the photo with its type and without sniffing',async()=>{
    const app=await createApp();
    queryMock.mockResolvedValueOnce({rows:[{avatar:jpeg,mime:'image/jpeg'}]});
    const response=await app.inject({method:'GET',url:`/api/users/${session.userId}/avatar`});
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/jpeg');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.rawPayload.equals(jpeg)).toBe(true);
    await app.close();
  });

  it('hides other users\' photos from regular accounts but shows them to administrators',async()=>{
    const app=await createApp();
    const denied=await app.inject({method:'GET',url:`/api/users/${otherUser}/avatar`});
    expect(denied.statusCode).toBe(404);
    expect(queryMock).not.toHaveBeenCalled();

    session.role='admin';
    queryMock.mockResolvedValueOnce({rows:[{avatar:png,mime:'image/png'}]});
    const allowed=await app.inject({method:'GET',url:`/api/users/${otherUser}/avatar`});
    expect(allowed.statusCode).toBe(200);
    expect(queryMock.mock.calls[0]?.[1]).toEqual([otherUser]);
    await app.close();
  });
});
