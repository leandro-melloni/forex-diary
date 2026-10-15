import { afterEach, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const clients: SupabaseClient[] = [];
afterEach(async () => {
  for (const client of clients) await client.auth.stopAutoRefresh();
  clients.length = 0;
  vi.unstubAllGlobals();
  vi.resetModules();
});

it('restaura login ao recarregar, limpa ao sair e não autentica uma nova sessão de navegador', async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  vi.stubGlobal('window', { sessionStorage: storage });
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    if (String(input).includes('/logout')) return new Response(null, { status: 204 });
    return new Response(JSON.stringify({
      access_token: 'test-access-token', refresh_token: 'test-refresh-token',
      expires_in: 3600, token_type: 'bearer',
      user: { id: 'user-a', aud: 'authenticated', email: 'test@example.invalid' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  async function loadClient() {
    vi.resetModules();
    const { supabase } = await import('../frontend/src/api');
    clients.push(supabase);
    await supabase.auth.stopAutoRefresh();
    return supabase;
  }
  const first = await loadClient();
  const signedIn = await first.auth.signInWithPassword({ email: 'test@example.invalid', password: 'test-password' });
  expect(signedIn.error).toBeNull();
  expect(values.size).toBeGreaterThan(0);

  const reloaded = await loadClient();
  expect((await reloaded.auth.getSession()).data.session?.user.id).toBe('user-a');
  expect((await reloaded.auth.signOut({ scope: 'local' })).error).toBeNull();
  expect((await reloaded.auth.getSession()).data.session).toBeNull();
  expect([...values.values()].some(value => value.includes('test-refresh-token'))).toBe(false);

  await first.auth.signInWithPassword({ email: 'test@example.invalid', password: 'test-password' });
  values.clear(); // O navegador descarta o sessionStorage ao encerrar a sessão da aba.
  const newBrowserSession = await loadClient();
  expect((await newBrowserSession.auth.getSession()).data.session).toBeNull();
});
