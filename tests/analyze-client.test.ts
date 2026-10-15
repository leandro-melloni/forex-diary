import { afterEach, expect, it, vi } from 'vitest';

const { invoke, getSession } = vi.hoisted(() => ({ invoke:vi.fn(),getSession:vi.fn() }));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({auth:{getSession},functions:{invoke}})}));
afterEach(()=>{vi.restoreAllMocks();vi.resetModules();});

it('respeita o tempo de espera sem consumir novas tentativas no backend',async()=>{
  let now=100000;
  vi.spyOn(Date,'now').mockImplementation(()=>now);
  getSession.mockResolvedValue({data:{session:{access_token:'test'}}});
  invoke.mockResolvedValueOnce({error:{context:new Response(JSON.stringify({erro:'Aguarde 60 segundos.',retryAfterSeconds:60}),{status:429})}});
  const {analyze}=await import('../frontend/src/api');
  await expect(analyze({registros:[]})).rejects.toThrow('Aguarde 60 segundos.');
  await expect(analyze({registros:[]})).rejects.toThrow('Aguarde 60 segundos antes de tentar novamente.');
  expect(invoke).toHaveBeenCalledTimes(1);
  now+=61000;
  invoke.mockResolvedValueOnce({data:{texto:'Análise concluída.',modelo:'gpt-5-mini'},error:null});
  await expect(analyze({registros:[]})).resolves.toMatchObject({texto:'Análise concluída.'});
  expect(invoke).toHaveBeenCalledTimes(2);
});
