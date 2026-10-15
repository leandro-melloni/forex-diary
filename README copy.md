# Forex Cloud — Supabase + Vercel

Nova versão independente. Os arquivos do sistema local anterior permanecem intactos.

```
frontend/       Vite + TypeScript: login, TOTP, cofre, diário e revisão
shared/         validação e cálculos reutilizados pelo backend
supabase/       banco com RLS, RPCs e Edge Function de análise
tests/          testes da criptografia, cálculos e salvamento
```

## Configuração local

Use Node.js 22.18+ ou 24+.

```powershell
cd forex-cloud
npm.cmd ci
Copy-Item frontend/.env.example frontend/.env.local
npm.cmd run dev
```

Preencha em `frontend/.env.local` apenas `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` (a chave pública/publishable do projeto). Não use chave secret/service-role ou OPENAI_API_KEY em variável VITE. Nenhum segredo da versão anterior foi copiado.

## Backend Supabase

Crie um projeto dedicado. Revise a migração em `supabase/migrations` antes de aplicá-la. A pasta contém apenas tabelas novas.

```powershell
supabase login
supabase link --project-ref SEU_PROJECT_REF
supabase db push
Copy-Item supabase/.env.example supabase/.env.production
# Edite o arquivo local: chave OpenAI, modelo e ALLOWED_ORIGINS exatas.
supabase secrets set --env-file supabase/.env.production
supabase functions deploy analyze-diary
```

O arquivo de secrets está ignorado pelo Git. `SUPABASE_URL` e `SUPABASE_ANON_KEY` são disponibilizadas pelo ambiente da Edge Function. Não é usada chave service-role.

No painel Auth do projeto hospedado:

1. Desabilite **Allow new users to sign up** e autenticação anônima.
2. Habilite TOTP MFA. Defina senha mínima de 12 caracteres, proteção de senhas vazadas quando disponível e limites de tentativas de login.
3. Crie sua conta em **Authentication → Users**, com email confirmado e senha forte. Não há cadastro público na interface.
4. Configure Site URL e redirect URLs somente para seu domínio e ambientes autorizados.
5. Configure expiração de JWT e de sessões conforme as opções do plano. Para teste local, adicione `http://localhost:5173` ou `http://127.0.0.1:5173` explicitamente em ALLOWED_ORIGINS; remova ao concluir.

O `config.toml` descreve o ambiente local e a função; não pressupõe que configurações Auth já foram aplicadas ao projeto hospedado.

## Frontend Vercel

Importe o repositório e selecione **Root Directory: forex-cloud**. O vercel.json define Vite, `npm run build` e saída `dist`.
Configure apenas as duas variáveis públicas VITE no projeto Vercel. Antes de publicar, substitua `https://*.supabase.co` no CSP de vercel.json pela origem exata do seu Supabase. Informe a origem final da Vercel em ALLOWED_ORIGINS no backend. Não permita automaticamente todos os previews Vercel; autorize cada ambiente deliberadamente.

Faça o deploy após validar as configurações. Nenhum projeto remoto foi criado ou publicado por esta refatoração.

## Primeiro uso e migração

1. Entre com email/senha e cadastre o autenticador TOTP.
2. Crie uma senha de cofre **diferente da senha de acesso**, com pelo menos 16 caracteres. Ela não é enviada ao Supabase e não tem recuperação.
3. No sistema antigo, exporte o backup JSON. Na nova versão, use **Backup → Importar**. A conversão acontece no navegador; só o resultado cifrado é enviado ao banco.
4. Revise corretoras, depósitos, resultados e stops gerais. Dados antigos de outras modalidades não são convertidos para USD.
5. Para analisar, escolha corretora/mês em **Revisão do diário** e confirme o envio do recorte. O texto retorna ao navegador e é salvo cifrado. São mantidas 20 análises.

O backup padrão da nova versão é criptografado. É possível importá-lo na mesma conta ou em outra conta informando a senha do cofre de origem. O conteúdo é então recifrado com a chave da conta de destino.

## Validação

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd audit
```

Com Supabase CLI e Docker disponíveis, inicie um ambiente local e rode os testes reais de isolamento:

```powershell
supabase start
supabase test db
```

Os testes unitários não substituem a validação de RLS e da função no projeto real. [SECURITY.md](SECURITY.md) descreve as garantias, os limites e a exceção de privacidade necessária para análise externa.

Referências: [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [TOTP](https://supabase.com/docs/guides/auth/auth-mfa/totp), [Auth nas funções](https://supabase.com/docs/guides/functions/auth), [Vite na Vercel](https://vercel.com/docs/frameworks/frontend/vite), [Web Crypto](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey).
