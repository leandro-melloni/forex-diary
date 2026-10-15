# Modelo de segurança e limites

Esta implementação reduz exposição; não existe garantia de segurança absoluta. Ela precisa de validação no projeto Supabase real e de revisão independente antes de receber dados sensíveis em produção.

## Dados criptografados

Todos os registros, corretoras, movimentos, configurações e análises são um único documento cifrado no navegador com AES-256-GCM, tag de 128 bits e IV aleatório de 96 bits por gravação. Uma chave de dados aleatória é protegida com outra chave derivada da senha do cofre por PBKDF2-SHA256, 600.000 iterações e salt aleatório de 128 bits. O identificador do usuário, versão e finalidade são dados autenticados adicionais. A chave usada em memória não é exportável pela Web Crypto API.

A senha do cofre nunca entra em requisições de autenticação, banco ou IA. O Supabase recebe apenas ciphertext e os parâmetros públicos necessários ao desbloqueio. Os tokens de autenticação ficam no sessionStorage da aba, com renovação automática enquanto a sessão for válida no Supabase. Recarregar mantém o login, mas exige desbloquear o cofre novamente: sua senha, chave e registros descriptografados permanecem apenas na memória. Não há saída por inatividade no aplicativo. Sair remove a sessão; fechar a aba ou o navegador encerra seu armazenamento de sessão, sujeito ao comportamento de restauração de abas do navegador. O aplicativo não usa localStorage, IndexedDB, cookies de aplicação ou caches offline para persistir esses dados.

O email, identificador de conta, informações de autenticação/MFA, horários, tamanho do ciphertext e contagens de uso da IA continuam visíveis aos respectivos provedores. A senha de LOGIN é tratada pelo Supabase Auth; é diferente da senha do COFRE. A criptografia não protege contra um navegador/dispositivo comprometido, extensões maliciosas ou uma versão adulterada do frontend enquanto o cofre estiver aberto. Strings/chaves liberadas ficam sujeitas ao gerenciamento de memória do navegador; não se promete apagamento físico imediato.

Não há recuperação da senha do cofre. Perder essa senha impede recuperar os dados, mesmo com acesso administrativo ao Supabase ou redefinição do login. Guarde a senha em um gerenciador e mantenha backups cifrados. Não oferecemos rotação automática dessa senha nesta versão.

## Controle de acesso

- Auth por email/senha; cadastro público desabilitado. Contas criadas pelo administrador.
- Autenticação por email/senha, sem MFA no aplicativo; RLS exige usuário autenticado e proprietário para ler.
- Escrita apenas pelo RPC com verificação explícita de usuário autenticado e revisão esperada. Nenhum `user_id` é aceito do cliente para escolher o proprietário.
- Revisão evita sobrescrita silenciosa entre dispositivos. Importar um backup é uma substituição explícita.
- Nenhuma chave service-role no frontend ou na função de análise. A função verifica o JWT online com `getUser` e o RPC usa a identidade do chamador.
- `verify_jwt=false` apenas desliga o gateway JWT legado; a função implementa autenticação obrigatória. Não remova `getUser`, verificação de Bearer nem verificação de usuário autenticado no RPC.
- Limite de 3 tentativas de IA/hora e 10/dia por usuário com transação e lock no banco. Tentativas que chegam à OpenAI contam mesmo se falharem.
- CORS com lista exata de origens, sem wildcard. CORS não substitui autenticação.
- DOM criado com textContent, sem eval, innerHTML dinâmico, handlers inline ou scripts de terceiros em runtime. CSP, HTTPS/HSTS, proteção contra frames e no-store configurados para Vercel.

## Exceção explícita: análise por IA

O fluxo manual prepara o prompt no navegador, sem chamadas à IA. Copiar coloca o texto descriptografado na área de transferência; o usuário escolhe onde compartilhar. O prompt inclui somente os lançamentos selecionados, métricas e configuração/limites correspondentes, sem senha do cofre ou chaves. A resposta colada é criptografada antes do salvamento. Alterações nos dados ou filtros exigem preparar uma nova solicitação antes de salvar.

Armazenamento é ponta a ponta entre os navegadores do usuário. A análise externa não pode manter os dados ilegíveis para quem os analisa: após consentimento por chamada, o recorte escolhido é enviado em texto legível por HTTPS à Edge Function e à OpenAI. A senha do cofre e as chaves nunca acompanham esse recorte. A função não armazena nem registra em logs o recorte ou a resposta. Retorna o texto ao navegador, que o cifra e salva no cofre. Não existe persistência de respostas em texto aberto no backend.

`store:false` desabilita armazenamento do objeto Response pela API; isso não equivale a garantia de Zero Data Retention. Os termos e políticas de retenção da conta/provedor continuam aplicáveis. Dados não selecionados ficam fora do envio. Se o navegador fechar antes de receber e cifrar a resposta, ela não será registrada no cofre. Erros de salvamento mantêm a resposta pendente em memória para nova tentativa, sem nova chamada paga.

## Antes de produção

Execute os testes pgTAP em um Supabase local ou staging, valide acesso entre duas contas reais, login por senha, backups, recuperação operacional e os headers na Vercel. Proteja contas administrativas de Supabase/Vercel/OpenAI com MFA e restrinja colaboradores. Desabilite signup no projeto hospedado; não basta alterar config.toml local. Configure senha forte, limites de sessão, limites de API e orçamento OpenAI no painel. Não habilite logs de body, gravação de sessão ou analytics que capturem dados.

A política CSP usa `https://*.supabase.co` para funcionar com projetos padrão; antes de publicar, substitua pelo endereço exato do seu projeto em vercel.json. Não adicione unsafe-inline/unsafe-eval. Projetos com domínio Supabase personalizado exigem ajuste explícito de CSP e validação de URL no frontend.
