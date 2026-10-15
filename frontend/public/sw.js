// Somente navegação: nenhum cache de dados, credenciais, HTML autenticado ou respostas de API.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || event.request.mode !== 'navigate' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).catch(() => new Response(
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Diário Forex · Sem conexão</title></head><body><main><h1>Diário Forex</h1><h2>Você está sem conexão</h2><p>Conecte-se à internet para entrar e carregar seu cofre com segurança.</p><p><a href="/">Tentar novamente</a></p></main></body></html>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
  )));
});
