import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { getUser, rpc } = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn() }));
vi.mock('npm:@supabase/supabase-js@2.118.0', () => ({
  createClient: () => ({ auth: { getUser }, rpc }),
}));
let handler: (request: Request) => Promise<Response>;
const upstream = vi.fn();
beforeEach(async () => {
  vi.resetModules();
  getUser.mockResolvedValue({ data: { user: { id: 'user-a' } } });
  rpc.mockResolvedValue({ error: null });
  upstream.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const env: Record<string,string> = { ALLOWED_ORIGINS:'https://diary.example', SUPABASE_URL:'https://test.supabase.co', SUPABASE_ANON_KEY:'public-key', OPENAI_API_KEY:'private-test-key' };
  vi.stubGlobal('Deno', { env:{get:(name:string)=>env[name]}, serve:(value:typeof handler)=>{handler=value;} });
  vi.stubGlobal('fetch', upstream);
  // O runtime Deno é simulado aqui; a função tem verificação de tipos separada.
  const functionPath='../supabase/functions/analyze-diary/index';
  await import(functionPath);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function request(){
  return new Request('https://test.supabase.co/functions/v1/analyze-diary', {
    method:'POST',headers:{origin:'https://diary.example',authorization:'Bearer test-token','content-type':'application/json'},
    body:JSON.stringify({consent:true,contexto:{registros:[{id:'one',corretora:'A',data:'2026-10-15',operacoes:1,wins:1,losses:0,resultadoFinanceiro:10,observacao:'private-diary-note',contexto:''}]}}),
  });
}
it('preserva 429 e tempo de espera sem expor mensagem bruta nem repetir a chamada',async()=>{
  upstream.mockResolvedValue(new Response(JSON.stringify({error:{code:'rate_limit_exceeded',message:'private-upstream-message'}}),{status:429,headers:{'retry-after':'12.5'}}));
  const response=await handler(request());
  expect(response.status).toBe(429);
  expect(response.headers.get('retry-after')).toBe('13');
  const body=await response.json();
  expect(body).toMatchObject({codigo:'openai_rate_limit',retryAfterSeconds:13});
  expect(body.erro).toContain('13 segundos');
  expect(JSON.stringify(body)).not.toContain('private-upstream-message');
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(/private-diary-note|private-test-key/);
  expect(upstream).toHaveBeenCalledTimes(1);
});
it.each([{code:'insufficient_quota'},{type:'insufficient_quota'}])('distingue falta de créditos de limite temporário: %j',async(error)=>{
  upstream.mockResolvedValue(new Response(JSON.stringify({error}),{status:429}));
  const response=await handler(request());
  expect(response.status).toBe(429);
  expect(await response.json()).toMatchObject({codigo:'openai_insufficient_quota'});
});
it('orienta reduzir o recorte quando a requisição excede a capacidade',async()=>{
  upstream.mockResolvedValue(new Response(JSON.stringify({error:{message:'Request too large for model on tokens per min'}}),{status:429}));
  expect(await (await handler(request())).json()).toMatchObject({codigo:'openai_request_too_large'});
});
it('não confunde falha no banco com limite atingido e não chama a OpenAI',async()=>{
  rpc.mockResolvedValue({error:{code:'08006'}});
  const response=await handler(request());
  expect(response.status).toBe(503);
  expect(upstream).not.toHaveBeenCalled();
});
it('continua retornando análise concluída',async()=>{
  upstream.mockResolvedValue(new Response(JSON.stringify({status:'completed',model:'gpt-5-mini',output:[{type:'message',content:[{type:'output_text',text:'Análise de teste.'}]}]}),{status:200}));
  const response=await handler(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({texto:'Análise de teste.',modelo:'gpt-5-mini'});
});
