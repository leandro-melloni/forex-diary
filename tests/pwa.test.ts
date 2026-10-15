import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {expect,it,vi} from 'vitest';

const publicFile=(path:string)=>readFileSync(new URL(`../frontend/public/${path}`,import.meta.url));
function worker(fetch:ReturnType<typeof vi.fn>){
  const handlers=new Map<string,(event:any)=>void>();
  runInNewContext(publicFile('sw.js').toString(),{self:{location:{origin:'https://diary.example'},addEventListener:(name:string,callback:(event:any)=>void)=>handlers.set(name,callback)},URL,Response,fetch});
  return handlers.get('fetch')!;
}
it('entrega manifesto instalável com ícones PNG nos tamanhos declarados e CSP compatível',()=>{
  const manifest=JSON.parse(publicFile('manifest.webmanifest').toString());
  expect(manifest).toMatchObject({start_url:'/',scope:'/',display:'standalone'});
  expect(manifest.icons.map((i:{sizes:string})=>i.sizes)).toEqual(expect.arrayContaining(['192x192','512x512']));
  for(const icon of manifest.icons){
    const png=publicFile(icon.src.slice(1));
    expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(icon.sizes);
  }
  const config=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
  const csp=config.headers[0].headers.find((header:{key:string})=>header.key==='Content-Security-Policy').value;
  expect(csp).toContain("manifest-src 'self'");expect(csp).toContain("worker-src 'self'");
});
it('não intercepta nem armazena requisições de autenticação, banco e gravação',()=>{
  const fetch=vi.fn(),handle=worker(fetch),respondWith=vi.fn();
  for(const request of [
    {url:'https://test.supabase.co/auth/v1/token',method:'POST',mode:'cors'},
    {url:'https://test.supabase.co/rest/v1/encrypted_vaults',method:'GET',mode:'cors'},
    {url:'https://diary.example/api/save',method:'POST',mode:'navigate'},
    {url:'https://other.example/',method:'GET',mode:'navigate'},
  ])handle({request,respondWith});
  expect(fetch).not.toHaveBeenCalled();expect(respondWith).not.toHaveBeenCalled();
});
it('exibe aviso offline sem depender de dados ou caches privados',async()=>{
  const handle=worker(vi.fn().mockRejectedValue(new TypeError('offline')));
  let response:Promise<Response>|undefined;
  handle({request:{url:'https://diary.example/',method:'GET',mode:'navigate'},respondWith:(value:Promise<Response>)=>{response=value;}});
  const offline=await response!;
  expect(offline.status).toBe(503);expect(offline.headers.get('cache-control')).toBe('no-store');
  expect(await offline.text()).toContain('Você está sem conexão');
});
it('usa a navegação atual do servidor quando há conexão',async()=>{
  const current=new Response('current-app'),handle=worker(vi.fn().mockResolvedValue(current));
  let response:Promise<Response>|undefined;
  handle({request:{url:'https://diary.example/',method:'GET',mode:'navigate'},respondWith:(value:Promise<Response>)=>{response=value;}});
  expect(await response).toBe(current);
});
