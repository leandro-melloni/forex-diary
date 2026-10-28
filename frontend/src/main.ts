import './style.css';
import { configured, supabase, readVault, writeVault, Vault, analyze } from './api';
import { createVault, unlockVault, validateEnvelope } from './crypto';
import { emptyDiary, validateDiary, importLegacy, metrics, forexSummary, opening, limits, validateStops, binaryOptions, binaryOptionsOpening, binaryOptionsLimits, type Diary, type TradeDay } from '../../shared/domain';
import { reviewContext, reviewPrompt } from '../../shared/review';
import { initializePwa, installWidget } from './pwa';

const root = document.querySelector<HTMLElement>('#app')!;
// Altere para true para reativar a revisão do diário na interface.
const SHOW_DIARY_REVIEW = false;
let vault: Vault | null = null;
let busy = false, tab = 'Diário';
let content: HTMLElement = root;
let pendingReview: { contexto:string; texto:string; modelo:string; id:string; data:string } | null = null;
let editingDay: TradeDay | undefined;
let tradingMode: 'Forex' | 'Opções Binárias' = 'Forex';
let editingBinaryDay: TradeDay | undefined;
let loginFingerprint: string | null = null;
async function fingerprint(value:string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).join(','); }
const money = (v:number) => v.toLocaleString('pt-BR',{style:'currency',currency:'USD'});
const reais = (v:number) => v.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
function node<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className='') {
  const el=document.createElement(tag); el.textContent=text; el.className=className; return el;
}
function message(text:string) { const box=document.querySelector('#status'); if (box) box.textContent=text; }
function shell(title:string) {
  content=root;
  root.className='container';
  root.replaceChildren(node('h1',title));
  const status=node('p','','status'); status.id='status'; status.setAttribute('role','status'); root.append(status);
  const connection=node('p','Sem conexão. Reconecte-se para carregar ou salvar seus dados.','connection-status');connection.hidden=navigator.onLine;connection.setAttribute('role','status');root.append(connection);
  const install=installWidget();if(install)root.append(install);
}
function card(title:string,parent:HTMLElement=content) { const el=node('section','','card'); el.append(node('h2',title)); parent.append(el); return el; }
function button(text:string,handler:()=>void,parent:HTMLElement) { const b=node('button',text); b.type='button'; b.className=/Excluir|Remover/.test(text)?'btn-delete':text==='Editar'?'btn-edit':'btn-secundario'; b.addEventListener('click',handler); parent.append(b); return b; }
function input(label:string,type='text',value='',parent:HTMLElement=root) {
  const l=node('label',label), i=node('input'); i.type=type; i.value=value; i.required=true; l.append(i); parent.append(l); return i;
}
function select(label:string,options:[string,string][],parent:HTMLElement) {
  const l=node('label',label), s=node('select'); for(const [value,text] of options){const o=node('option',text);o.value=value;s.append(o);}l.append(s);parent.append(l);return s;
}
function textarea(label:string,value:string,parent:HTMLElement) {
  const l=node('label',label),i=node('textarea');i.value=value;i.maxLength=6000;i.rows=3;l.append(i);parent.append(l);return i;
}
function submit(text:string,form:HTMLFormElement,action:()=>Promise<void>) {
  const b=node('button',text);b.type='submit';form.append(b);form.addEventListener('submit',e=>{e.preventDefault();void run(action);});return b;
}
async function run(action:()=>Promise<void>) {
  if(busy)return;busy=true;message('Processando...');root.setAttribute('aria-busy','true');
  try{await action();}catch(e){message(e instanceof Error?e.message:'Não foi possível concluir.');}
  finally{busy=false;root.removeAttribute('aria-busy');}
}
function download(data:unknown,name:string) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const a=node('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exit() { vault=null;pendingReview=null;loginFingerprint=null;root.replaceChildren();void supabase.auth.signOut({scope:'local'}).finally(()=>location.reload()); }
supabase.auth.onAuthStateChange((event)=>{ if(event==='SIGNED_OUT'){vault=null;pendingReview=null;loginFingerprint=null;login();} });

function login() {
  shell('Diário Forex privado');
  root.classList.add('login-screen');
  if(!configured){message('Configure VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no frontend antes de publicar. Consulte o README.');return;}
  const c=card('Entrar'),f=node('form','','login-form');c.append(f);
  const email=input('E-mail','email','',f);email.autocomplete='username';
  const password=input('Senha de acesso','password','',f);password.autocomplete='current-password';
  submit('Entrar',f,async()=>{
    const secret=password.value;password.value='';
    const {error}=await supabase.auth.signInWithPassword({email:email.value.trim(),password:secret});
    if(error)throw new Error('Não foi possível entrar. Confira as credenciais e tente novamente.');
    loginFingerprint=await fingerprint(secret);
    await vaultGate();
  });
  c.append(node('p','O acesso é criado pelo administrador do projeto. O login permanece ativo nesta aba até você sair ou fechar o navegador.','login-help'));
}
async function vaultGate() {
  const {data,error}=await supabase.auth.getUser();
  if(error||!data.user)throw new Error('Sessão inválida. Entre novamente.');
  const uid=data.user.id,row=await readVault(uid);
  shell('Seu cofre privado');const c=card(row?'Desbloquear dados':'Criar senha do cofre');
  c.append(node('p','Esta senha é separada da senha de acesso e não é enviada ao servidor. Se perdê-la, os dados não poderão ser recuperados, mesmo redefinindo o login. Guarde-a em um gerenciador de senhas.'));
  const f=node('form');c.append(f);const pass=input('Senha do cofre (mínimo 16 caracteres)','password','',f);pass.minLength=16;pass.autocomplete=row?'current-password':'new-password';
  const repeat=row?null:input('Repita a senha do cofre','password','',f);
  if(repeat)repeat.autocomplete='new-password';
  submit(row?'Desbloquear':'Criar cofre criptografado',f,async()=>{
    const secret=pass.value,confirmation=repeat?.value;pass.value='';if(repeat)repeat.value='';
    if(!row&&secret!==confirmation)throw new Error('As senhas do cofre não coincidem.');
    if(!row&&loginFingerprint===await fingerprint(secret))throw new Error('Escolha uma senha do cofre diferente da senha usada no login.');
    if(row){const opened=await unlockVault(uid,secret,row.envelope);validateDiary(opened.value);vault=new Vault(uid,row.revision,row.envelope,opened.key,opened.value);}
    else{const diary=emptyDiary(),created=await createVault(uid,secret,diary);const revision=await writeVault(0,created.envelope);vault=new Vault(uid,revision,created.envelope,created.key,diary);}
    loginFingerprint=null;render();
  });
  button('Sair',exit,c);
}

async function change(edit:(d:Diary)=>void) {
  if(!vault)throw new Error('Cofre bloqueado.');
  const next=structuredClone(vault.diary);edit(next);await vault.save(next);editingDay=undefined;render();message('Salvo criptografado no Supabase.');
}
function table(headers:string[],rows:(string|HTMLElement)[][],parent:HTMLElement){
  const wrapper=node('div','','table-responsive'),t=node('table'),head=node('tr');for(const h of headers)head.append(node('th',h));
  const thead=node('thead');thead.append(head);t.append(thead);const body=node('tbody');
  for(const row of rows){const tr=node('tr');row.forEach((value,index)=>{const td=node('td');td.dataset.label=headers[index];typeof value==='string'?td.textContent=value:td.append(value);tr.append(td);});body.append(tr);}
  t.append(body);wrapper.append(t);parent.append(wrapper);
  if(!rows.length)parent.append(node('p','Nenhum registro neste recorte.','empty-msg'));
}
function render(){
  if(!vault)return;shell('📈 Diário de Trading Forex');
  root.classList.add('authenticated');
  const bar=node('header','','session-bar');bar.append(node('span','Cofre aberto · dados cifrados no armazenamento'));button('Sair',exit,bar);root.append(bar);
  const nav=node('nav','','tabs-nav');nav.setAttribute('aria-label','Seções do diário');root.append(nav);
  for(const [label,title] of [['Movimentações','💸 Depósitos e Saques'],['Diário','💱 Diário de trading'],['Revisão do diário','📝 Revisão do diário'],['Evolução','📊 Evolução'],['Configurações','🏢 Cadastros e Configurações'],['Backup','💾 Backup e Dados']]){
    if(label==='Revisão do diário'&&!SHOW_DIARY_REVIEW)continue;
    const b=button(title,()=>{if(!busy){tab=label;editingDay=undefined;render();}},nav);b.className=`tab-btn${tab===label?' active':''}`;if(tab===label)b.setAttribute('aria-current','page');
    b.replaceChildren(node('span',title,'nav-desktop'),node('span',title.split(' ')[0],'nav-icon'),node('span',label==='Movimentações'?'Movimentos':label==='Diário'?'Diário de trading':label==='Configurações'?'Ajustes':label==='Revisão do diário'?'Revisão':label,'nav-mobile'));b.setAttribute('aria-label',title);
  }
  content=node('div','','tab-content active');content.id=tab==='Diário'&&tradingMode==='Forex'?'abaForex':tab==='Evolução'?'abaEvolucao':'abaAtual';root.append(content);
  if(tab==='Diário'){
    const modes=node('nav','','tabs-nav');modes.setAttribute('aria-label','Modalidades de trading');content.append(modes);
    for(const mode of ['Forex','Opções Binárias'] as const){const b=button(mode,()=>{tradingMode=mode;editingDay=undefined;editingBinaryDay=undefined;render();},modes);b.className=`tab-btn${tradingMode===mode?' active':''}`;if(tradingMode===mode)b.setAttribute('aria-current','page');}
    if(tradingMode==='Forex')diaryView(editingDay);else binaryOptionsView();
  }
  if(tab==='Movimentações')movementView();if(tab==='Evolução')evolutionView();
  if(SHOW_DIARY_REVIEW&&tab==='Revisão do diário')reviewView();if(tab==='Configurações')settingsView();if(tab==='Backup')backupView();
}
function brokers(parent:HTMLElement,all=false){return select('Corretora',[...(all?[['','Todas'] as [string,string]]:[]),...vault!.diary.corretoras.map(n=>[n,n] as [string,string])],parent);}
function binaryOptionsView(){
  const ob=binaryOptions(vault!.diary),edit=editingBinaryDay,c=card(edit?'Editar lançamento de OB':'Novo lançamento de Opções Binárias');
  if(!ob.corretoras.length){c.append(node('p','Cadastre uma corretora de Opções Binárias em Configurações para começar.'));return;}
  const f=node('form','','grid');c.append(f);const broker=select('Corretora',ob.corretoras.map(n=>[n,n]),f);if(edit)broker.value=edit.corretora;
  const date=input('Data','date',edit?.data||new Date().toLocaleDateString('en-CA'),f),ops=input('Operações','number',String(edit?.operacoes??1),f),wins=input('Wins','number',String(edit?.wins??0),f),losses=input('Losses','number',String(edit?.losses??0),f);
  for(const i of [ops,wins,losses]){i.min=i===ops?'1':'0';i.step='1';}
  const result=input('Resultado financeiro líquido (R$)','number',edit?String(edit.resultadoFinanceiro):'',f);result.step='.01';
  const notes=textarea('Observações',edit?.observacao||'',f),context=textarea('Contexto e lições',edit?.contexto||'',f),panel=node('p','','notice');c.append(panel);
  const update=()=>{const base=binaryOptionsOpening(vault!.diary,broker.value,date.value),limit=binaryOptionsLimits(vault!.diary,broker.value,date.value);if(!limit){panel.textContent=`Saldo de abertura: ${reais(base)}. Configure os stops de OB e registre um depósito para calcular os limites.`;return;}
    const net=Math.round((ob.dias.filter(i=>i.corretora===broker.value&&i.data===date.value&&i.id!==edit?.id).reduce((s,i)=>s+i.resultadoFinanceiro,0)+(Number(result.value)||0))*100)/100;
    panel.textContent=`Saldo de abertura: ${reais(base)} · Stop Loss: ${reais(limit.lossBRL)} · Stop Win: ${reais(limit.winBRL)} · Resultado (prévia): ${reais(net)}. `+(net<=-limit.lossBRL?'STOP LOSS ATINGIDO: encerre a sessão.':net>=limit.winBRL?'STOP WIN ATINGIDO: encerre a sessão.':`Margem até a perda diária: ${reais(Math.max(0,limit.lossBRL+net))}; falta para o Stop Win: ${reais(Math.max(0,limit.winBRL-net))}.`);
  };for(const el of [broker,date,result])el.addEventListener('input',update);update();
  submit('Salvar dia de OB',f,()=>change(d=>{if(binaryOptionsOpening(d,broker.value,date.value)<=0)throw new Error('Registre um depósito e confira o saldo de abertura antes de lançar resultados.');const item:TradeDay={id:edit?.id||crypto.randomUUID(),corretora:broker.value,data:date.value,operacoes:Number(ops.value),wins:Number(wins.value),losses:Number(losses.value),resultadoFinanceiro:Number(result.value),observacao:notes.value.trim(),contexto:context.value.trim()};if(!d.opcoesBinarias)d.opcoesBinarias={corretoras:[],dias:[],movimentos:[]};if(edit)d.opcoesBinarias.dias=d.opcoesBinarias.dias.map(i=>i.id===edit.id?item:i);else d.opcoesBinarias.dias.push(item);editingBinaryDay=undefined;}));
  if(edit){button('Cancelar',()=>{editingBinaryDay=undefined;render();},c);return;}
  const filters=card('Filtros de OB'),controls=node('div','','grid');filters.append(controls);const filterBroker=select('Corretora',[['','Todas'],...ob.corretoras.map(n=>[n,n] as [string,string])],controls),filterResult=select('Resultado do dia',[['','Todos'],['Win','Win'],['Loss','Loss'],['Zero','Zero a zero']],controls),month=input('Mês','month','',controls);month.required=false;
  const summary=card('Resumo de Opções Binárias'),summaryArea=node('div');summary.append(summaryArea);const history=node('details','','collapsible-history'),area=node('div');history.append(node('summary','Histórico diário de OB'),area);content.append(history);
  const refresh=()=>{summaryArea.replaceChildren();area.replaceChildren();const selected=ob.dias.filter(i=>(!filterBroker.value||i.corretora===filterBroker.value)&&(!filterResult.value||(i.resultadoFinanceiro>0?'Win':i.resultadoFinanceiro<0?'Loss':'Zero')===filterResult.value)&&(!month.value||i.data.startsWith(month.value))).sort((a,b)=>b.data.localeCompare(a.data)),m=forexSummary({...vault!.diary,dias:ob.dias,movimentos:ob.movimentos},selected),hint=m.variasCorretoras?' (selecione uma corretora)':'';
    summaryCards([['Dias lançados',String(m.diasLancados)],['Dias com lucro',String(m.diasWin)],['Dias com prejuízo',String(m.diasLoss)],['Dias no zero',String(m.diasZero)],['Total de operações',String(m.operacoes)],['Taxa de acerto',`${m.taxaAcerto.toFixed(1)}%`],['Resultado financeiro (BRL)',reais(m.resultado),m.resultado],[`Ganho/perda no filtro${hint}`,m.percentualAcumulado===null?'—':`${m.percentualAcumulado.toFixed(2)}%`,m.percentualAcumulado??0],['Média diária',m.percentualMedio===null?'—':`${m.percentualMedio.toFixed(2)}%`,m.percentualMedio??0]],summaryArea);
    table(['Data','Corretora','Operações','Wins/Losses','Resultado','Observações','Ações'],selected.map(i=>{const actions=node('div','','actions');button('Editar',()=>{editingBinaryDay=i;render();},actions);button('Excluir',()=>{if(confirm('Excluir este lançamento?'))void run(()=>change(d=>{d.opcoesBinarias!.dias=d.opcoesBinarias!.dias.filter(v=>v.id!==i.id);}));},actions);return[i.data,i.corretora,String(i.operacoes),`${i.wins}/${i.losses}`,node('span',reais(i.resultadoFinanceiro),i.resultadoFinanceiro<0?'val-negativo':'val-positivo'),i.observacao,actions];}),area);
  };for(const el of [filterBroker,filterResult,month])el.addEventListener('change',refresh);button('Limpar filtros',()=>{filterBroker.value='';filterResult.value='';month.value='';refresh();},controls);refresh();
}
function diaryView(edit?:TradeDay){
  const c=card(edit?'Editar lançamento':'Novo lançamento Forex');
  if(!vault!.diary.corretoras.length){c.append(node('p','Cadastre uma corretora em Configurações para começar.'));return;}
  const f=node('form','','grid');c.append(f);const broker=brokers(f);if(edit)broker.value=edit.corretora;
  const date=input('Data','date',edit?.data||new Date().toLocaleDateString('en-CA'),f);
  const ops=input('Operações','number',String(edit?.operacoes??1),f);ops.min='1';ops.step='1';
  const wins=input('Wins','number',String(edit?.wins??0),f);wins.min='0';wins.step='1';
  const losses=input('Losses','number',String(edit?.losses??0),f);losses.min='0';losses.step='1';
  const result=input('Resultado financeiro líquido (US$)','number',edit?String(edit.resultadoFinanceiro):'',f);result.step='.01';
  const notes=textarea('Observações',edit?.observacao||'',f),context=textarea('Contexto e lições',edit?.contexto||'',f);
  const panel=node('p','','notice');c.append(panel);
  const update=()=>{
    const d=vault!.diary,l=limits(d,broker.value,date.value),base=opening(d,broker.value,date.value);
    if(!l){panel.textContent=`Saldo de abertura: ${money(base)}. Configure os stops gerais e registre um depósito para calcular os limites.`;return;}
    const net=Math.round((d.dias.filter(i=>i.corretora===broker.value&&i.data===date.value&&i.id!==edit?.id).reduce((s,i)=>s+i.resultadoFinanceiro,0)+(Number(result.value)||0))*100)/100;
    panel.textContent=`Saldo de abertura: ${money(l.saldoBase)} · Stop Loss: ${money(l.lossUSD)} · Stop Win: ${money(l.winUSD)} · Resultado (prévia): ${money(net)}. `+
      (net<=-l.lossUSD?'STOP LOSS ATINGIDO: encerre a sessão.':net>=l.winUSD?'STOP WIN ATINGIDO: encerre a sessão.':`Margem até a perda diária: ${money(Math.max(0,l.lossUSD+net))}; falta para o Stop Win: ${money(Math.max(0,l.winUSD-net))}.`);
  };
  for(const el of [broker,date,result])el.addEventListener('input',update);update();
  c.append(node('p','A margem é a distância ao limite líquido diário, não um risco recomendado por operação. O sistema não acompanha posições abertas nem bloqueia ordens na corretora.'));
  submit('Salvar dia',f,()=>change(d=>{
    if(opening(d,broker.value,date.value)<=0)throw new Error('Registre um depósito e confira o saldo de abertura antes de lançar resultados.');
    const item:TradeDay={id:edit?.id||crypto.randomUUID(),corretora:broker.value,data:date.value,operacoes:Number(ops.value),wins:Number(wins.value),losses:Number(losses.value),resultadoFinanceiro:Number(result.value),observacao:notes.value.trim(),contexto:context.value.trim()};
    if(edit)d.dias=d.dias.map(i=>i.id===edit.id?item:i);else d.dias.push(item);
  }));
  if(edit){button('Cancelar',()=>{editingDay=undefined;render();},c);return;}
  const filtersCard=card('Filtros Forex'),filters=node('div','','grid');filtersCard.append(filters);const filterBroker=brokers(filters,true),filterResult=select('Resultado do dia',[['','Todos'],['Win','Win'],['Loss','Loss'],['Zero','Zero a zero']],filters),month=input('Mês','month','',filters);month.required=false;
  const summary=card('Resumo Forex'),summaryArea=node('div');summary.append(summaryArea);
  const history=node('details','','collapsible-history'),area=node('div');history.append(node('summary','Histórico diário Forex'),area);content.append(history);
  const refresh=()=>{area.replaceChildren();summaryArea.replaceChildren();const selected=vault!.diary.dias.filter(i=>(!filterBroker.value||i.corretora===filterBroker.value)&&(!filterResult.value||(i.resultadoFinanceiro>0?'Win':i.resultadoFinanceiro<0?'Loss':'Zero')===filterResult.value)&&(!month.value||i.data.startsWith(month.value))).sort((a,b)=>b.data.localeCompare(a.data));const m=forexSummary(vault!.diary,selected),hint=m.variasCorretoras?' (selecione uma corretora)':'';
    const grid=summaryCards([
      ['Dias lançados',String(m.diasLancados)],['Dias com lucro',String(m.diasWin),0],['Dias com prejuízo',String(m.diasLoss),-1],['Dias no zero',String(m.diasZero)],['Total de operações',String(m.operacoes)],['Taxa de acerto',`${m.taxaAcerto.toFixed(1)}%`],['Resultado financeiro (USD)',money(m.resultado),m.resultado],
      [`Ganho/perda no filtro${hint}`,m.percentualAcumulado===null?'—':`${m.percentualAcumulado.toFixed(2)}%`,m.percentualAcumulado??0,'Resultado financeiro filtrado dividido pelo saldo antes do primeiro lançamento mais os depósitos até o último lançamento.'],
      ['Média diária',m.percentualMedio===null?'—':`${m.percentualMedio.toFixed(2)}%`,m.percentualMedio??0,'Média aritmética das porcentagens diárias por corretora: resultado filtrado de cada dia dividido pelo saldo de abertura da corretora nesse dia. Dias sem saldo de abertura positivo ficam fora da média.']
    ],summaryArea);grid.id='resumoForex';
    table(['Data','Corretora','Operações','Wins/Losses','Resultado','Observações','Ações'],selected.map(i=>{
      const actions=node('div','','actions');button('Editar',()=>{if(!busy){editingDay=i;render();}},actions);
      button('Excluir',()=>{if(confirm('Excluir este lançamento?'))void run(()=>change(d=>{d.dias=d.dias.filter(v=>v.id!==i.id);}));},actions);
      return [i.data,i.corretora,String(i.operacoes),`${i.wins}/${i.losses}`,node('span',money(i.resultadoFinanceiro),i.resultadoFinanceiro<0?'val-negativo':'val-positivo'),i.observacao,actions];
    }),area);
  };filterBroker.addEventListener('change',refresh);filterResult.addEventListener('change',refresh);month.addEventListener('change',refresh);button('Limpar filtros',()=>{filterBroker.value='';filterResult.value='';month.value='';refresh();},filters);refresh();
}
function summaryCards(items:[string,string,number?,string?][],parent:HTMLElement){
  const grid=node('div','','resumo-grid');
  for(const [label,value,amount,title] of items){const item=node('div','','resumo-item');if(title)item.title=title;item.append(node('span',label),node('strong',value,amount===undefined?'':amount<0?'val-negativo':'val-positivo'));grid.append(item);}
  parent.append(grid);
  return grid;
}
function movementView(){
  const modes=node('nav','','tabs-nav');modes.setAttribute('aria-label','Modalidades de movimentações');content.append(modes);
  for(const mode of ['Forex','Opções Binárias'] as const){const b=button(mode,()=>{tradingMode=mode;render();},modes);b.className=`tab-btn${tradingMode===mode?' active':''}`;if(tradingMode===mode)b.setAttribute('aria-current','page');}
  if(tradingMode==='Opções Binárias'){binaryOptionsMovementView();return;}
  const c=card('Novo lançamento · Depósitos e Saques'),f=node('form','','grid');c.append(f);
  if(!vault!.diary.corretoras.length){c.append(node('p','Cadastre uma corretora em Configurações.'));return;}
  const broker=brokers(f),type=select('Tipo',[['Deposito','Depósito'],['Saque','Saque']],f),date=input('Data','date',new Date().toLocaleDateString('en-CA'),f),value=input('Valor (US$)','number','',f);value.min='.01';value.step='.01';
  submit('Salvar movimento',f,()=>change(d=>{d.movimentos.push({id:crypto.randomUUID(),corretora:broker.value,data:date.value,tipo:type.value as 'Deposito'|'Saque',valor:Number(value.value)});}));
  const filters=card('Filtros'),grid=node('div','','grid');filters.append(grid);
  const filterBroker=brokers(grid,true),filterType=select('Tipo de operação',[['','Todos'],['Deposito','Depósito'],['Saque','Saque']],grid),month=input('Mês','month','',grid);month.required=false;
  const summary=card('Resumo por Corretora'),history=node('details','','collapsible-history'),historyContent=node('div');
  history.append(node('summary','Histórico de movimentações'),historyContent);content.append(history);
  const refresh=()=>{
    summary.replaceChildren(node('h2','Resumo por Corretora'));historyContent.replaceChildren();
    const selected=vault!.diary.movimentos.filter(i=>(!filterBroker.value||i.corretora===filterBroker.value)&&(!filterType.value||i.tipo===filterType.value)&&(!month.value||i.data.startsWith(month.value)));
    table(['Corretora','Total Depósitos','Total Saques','Saldo de movimentos'],vault!.diary.corretoras.filter(n=>!filterBroker.value||n===filterBroker.value).map(n=>{
      const items=selected.filter(i=>i.corretora===n),deposits=items.filter(i=>i.tipo==='Deposito').reduce((s,i)=>s+i.valor,0),withdrawals=items.filter(i=>i.tipo==='Saque').reduce((s,i)=>s+i.valor,0);
      return[n,money(deposits),money(withdrawals),money(deposits-withdrawals)];
    }),summary);
    table(['Data','Corretora','Tipo','Valor','Ação'],selected.slice().sort((a,b)=>b.data.localeCompare(a.data)).map(i=>{const a=node('div');button('Excluir',()=>{if(confirm('Excluir este movimento? Isso recalculará os saldos de abertura.'))void run(()=>change(d=>{d.movimentos=d.movimentos.filter(v=>v.id!==i.id);}));},a);return[i.data,i.corretora,i.tipo==='Deposito'?'Depósito':'Saque',node('span',money(i.valor),i.tipo==='Deposito'?'val-positivo':'val-negativo'),a];}),historyContent);
  };
  for(const control of [filterBroker,filterType,month])control.addEventListener('change',refresh);
  button('Limpar filtros',()=>{filterBroker.value='';filterType.value='';month.value='';refresh();},grid);refresh();
}
function binaryOptionsMovementView(){
  const ob=binaryOptions(vault!.diary),c=card('Novo lançamento · Depósitos e Saques de OB');
  if(!ob.corretoras.length){c.append(node('p','Cadastre uma corretora de Opções Binárias em Configurações.'));return;}
  const f=node('form','','grid');c.append(f);const broker=select('Corretora',ob.corretoras.map(n=>[n,n]),f),type=select('Tipo',[['Deposito','Depósito'],['Saque','Saque']],f),date=input('Data','date',new Date().toLocaleDateString('en-CA'),f),value=input('Valor (R$)','number','',f);value.min='.01';value.step='.01';
  submit('Salvar movimento de OB',f,()=>change(d=>{if(!d.opcoesBinarias)d.opcoesBinarias={corretoras:[],dias:[],movimentos:[]};d.opcoesBinarias.movimentos.push({id:crypto.randomUUID(),corretora:broker.value,data:date.value,tipo:type.value as 'Deposito'|'Saque',valor:Number(value.value)});}));
  const summary=card('Resumo por Corretora de OB');table(['Corretora','Total Depósitos','Total Saques','Saldo de movimentos'],ob.corretoras.map(n=>{const items=ob.movimentos.filter(i=>i.corretora===n),deposits=items.filter(i=>i.tipo==='Deposito').reduce((s,i)=>s+i.valor,0),withdrawals=items.filter(i=>i.tipo==='Saque').reduce((s,i)=>s+i.valor,0);return[n,reais(deposits),reais(withdrawals),reais(deposits-withdrawals)];}),summary);
  const history=node('details','','collapsible-history'),area=node('div');history.append(node('summary','Histórico de movimentações de OB'),area);content.append(history);
  table(['Data','Corretora','Tipo','Valor','Ação'],ob.movimentos.slice().sort((a,b)=>b.data.localeCompare(a.data)).map(i=>{const actions=node('div');button('Excluir',()=>{if(confirm('Excluir este movimento? Isso recalculará os saldos de abertura.'))void run(()=>change(d=>{d.opcoesBinarias!.movimentos=d.opcoesBinarias!.movimentos.filter(v=>v.id!==i.id);}));},actions);return[i.data,i.corretora,i.tipo==='Deposito'?'Depósito':'Saque',reais(i.valor),actions];}),area);
}
function settingsView(){
  stopsView();
  const b=card('Corretoras Forex'),bf=node('form','','grid');b.append(bf);const name=input('Nome da corretora','text','',bf);name.maxLength=200;
  submit('Cadastrar',bf,()=>change(d=>{const n=name.value.trim().toUpperCase();if(!n||d.corretoras.includes(n))throw new Error('Informe uma corretora nova.');d.corretoras.push(n);}));
  for(const n of vault!.diary.corretoras){const p=node('p',`${n} · USD`);button('Remover',()=>void run(()=>change(d=>{if(d.dias.some(i=>i.corretora===n)||d.movimentos.some(i=>i.corretora===n))throw new Error('A corretora possui registros.');d.corretoras=d.corretoras.filter(v=>v!==n);})),p);b.append(p);}
  const ob=card('Corretoras de Opções Binárias'),form=node('form','','grid');ob.append(form);const obName=input('Nome da corretora','text','',form);obName.maxLength=200;
  submit('Cadastrar corretora de OB',form,()=>change(d=>{const name=obName.value.trim().toUpperCase();const list=binaryOptions(d).corretoras;if(!name||list.includes(name))throw new Error('Informe uma corretora de OB nova.');if(!d.opcoesBinarias)d.opcoesBinarias={corretoras:[],dias:[],movimentos:[]};d.opcoesBinarias.corretoras.push(name);}));
  for(const name of binaryOptions(vault!.diary).corretoras){const row=node('p',`${name} · BRL (R$)`);button('Remover',()=>void run(()=>change(d=>{const entries=binaryOptions(d);if(entries.dias.some(i=>i.corretora===name)||entries.movimentos.some(i=>i.corretora===name))throw new Error('A corretora possui registros.');d.opcoesBinarias!.corretoras=entries.corretoras.filter(v=>v!==name);})),row);ob.append(row);}
  const stops=card('Stop Loss e Stop Win de Opções Binárias'),sf=node('form','','grid');stops.append(sf);const configured=binaryOptions(vault!.diary).stops,loss=input('Stop Loss diário (% do saldo de abertura)','number',String(configured?.loss??''),sf),win=input('Stop Win diário (% do saldo de abertura)','number',String(configured?.win??''),sf);for(const i of [loss,win]){i.min='.01';i.max='100';i.step='.01';}
  submit('Salvar limites de OB',sf,()=>change(d=>{const next={unidade:'percentual' as const,loss:Number(loss.value),win:Number(win.value),configuradoEm:new Date().toISOString()};validateStops(next);if(!d.opcoesBinarias)d.opcoesBinarias={corretoras:[],dias:[],movimentos:[]};d.opcoesBinarias.stops=next;}));
}
function stopsView(){
  const c=card('Configuração geral de Stop Loss e Stop Win'),f=node('form','','grid');c.append(f);
  const s=vault!.diary.stops,unit=select('Unidade',[['percentual','% do saldo de abertura'],['usd','US$ fixos']],f);unit.value=s?.unidade||'percentual';
  const loss=input('Stop Loss diário','number',String(s?.loss??''),f),win=input('Stop Win diário','number',String(s?.win??''),f);for(const i of [loss,win]){i.min='.01';i.step='.01';}
  submit('Salvar configuração geral',f,()=>change(d=>{const stops={unidade:unit.value as 'percentual'|'usd',loss:Number(loss.value),win:Number(win.value),configuradoEm:new Date().toISOString()};validateStops(stops);d.stops=stops;}));
  c.append(node('p','Aplicada a todas as corretoras e datas. Consultas antigas usam a regra atual e não comprovam quais limites existiam na época.'));
}
function reviewView(){
  const filters=card('Revisão do diário');filters.append(node('p','Selecione o recorte para revisar seu desempenho no Forex. Estes filtros são independentes dos filtros do histórico.'));
  const grid=node('div','','grid');filters.append(grid);
  const broker=brokers(grid,true),resultFilter=select('Resultado do dia',[['','Todos'],['Win','Win'],['Loss','Loss'],['Zero','Zero a zero']],grid),month=input('Mês','month','',grid);month.required=false;
  const context=()=>reviewContext(vault!.diary,{corretora:broker.value,resultado:resultFilter.value,mes:month.value});
  const c=card('Limites e melhorias');c.append(node('p','O diagnóstico abaixo é calculado localmente. Prepare a solicitação para analisar o recorte no ChatGPT ou em outro assistente e depois salve a resposta no diário.'),node('p','Metodologia adaptada de Trader Memory Core: plano → execução → resultado → lições.'));
  const diagnostic=node('div');diagnostic.setAttribute('aria-live','polite');c.append(diagnostic);
  const manual=card('Análise externa · copiar solicitação e colar resposta');
  manual.append(node('p','1. Prepare a solicitação com os filtros atuais. 2. Revise e copie o texto para seu assistente de IA. 3. Cole a resposta abaixo e salve. A geração do prompt acontece no navegador, sem chamada à API OpenAI. O texto inclui resultados e anotações; revise antes de compartilhar.'));
  let snapshot:string|null=null;
  const prepare=()=>{
    const selected=context();
    try{const generated=reviewPrompt(selected);snapshot=JSON.stringify(selected);prompt.value=generated;answer.value='';message('Solicitação preparada. Revise os dados, copie e envie ao seu assistente de IA.');}
    catch(e){snapshot=null;prompt.value='';message(e instanceof Error?e.message:'Não foi possível preparar a solicitação.');}
  };
  const prepareButton=button('Preparar solicitação para IA',prepare,manual);prepareButton.className='';
  const prompt=textarea('Solicitação e dados para revisar e copiar','',manual);prompt.id='promptForexIA';prompt.rows=10;prompt.readOnly=true;prompt.removeAttribute('maxlength');
  const copyButton=button('Copiar solicitação',()=>{
    if(!prompt.value||snapshot!==JSON.stringify(context()))prepare();
    if(!prompt.value)return;
    void (async()=>{try{await navigator.clipboard.writeText(prompt.value);message('Solicitação copiada. Cole no ChatGPT ou no assistente de sua preferência.');}
    catch{prompt.focus();prompt.select();message('Cópia automática indisponível. Texto selecionado: use Ctrl+C ou o comando Copiar.');}})();
  },manual);
  const answerForm=node('form');manual.append(answerForm);
  const answer=textarea('Resposta da IA','',answerForm);answer.id='respostaForexIA';answer.rows=10;answer.maxLength=60000;answer.required=true;answer.placeholder='Cole a análise produzida pelo seu assistente.';
  const saveButton=submit('Salvar análise no diário',answerForm,async()=>{
    if(!snapshot||!prompt.value)throw new Error('Prepare a solicitação e cole a resposta da IA antes de salvar.');
    if(snapshot!==JSON.stringify(context()))throw new Error('Os dados ou filtros mudaram desde a preparação. Prepare uma nova solicitação para analisar o recorte atual.');
    const text=answer.value.trim();if(!text)throw new Error('Cole a resposta da IA antes de salvar.');
    if(pendingReview)throw new Error('Salve a análise pendente antes de registrar outra resposta.');
    pendingReview={id:crypto.randomUUID(),data:new Date().toISOString(),contexto:snapshot,texto:text,modelo:'Análise externa'};
    await persistReview();
  });
  manual.append(node('p','A resposta é criptografada antes de salvar no Supabase. São mantidas as 20 análises mais recentes, também incluídas no backup.'));
  const update=()=>{
    const selected=context(),m=metrics(selected.registros);diagnostic.replaceChildren();
    if(resultFilter.value)diagnostic.append(node('p','O filtro de resultado exclui parte dos dias e pode distorcer taxa de acerto, sequências e drawdown. Use “Todos” para revisar desempenho.','val-negativo'));
    if(!m.lancamentos)diagnostic.append(node('p','Nenhum lançamento nos filtros atuais. Registre seus dias ou ajuste os filtros para iniciar a revisão.'));
    else{
      diagnostic.append(node('p',`Recorte: ${m.dias} datas, ${m.lancamentos} lançamentos e ${m.operacoes} operações. Resultado registrado: ${money(m.resultadoLiquidoRegistrado)}. Acerto entre wins/losses: ${m.taxaAcerto===null?'não disponível':m.taxaAcerto.toFixed(1)+'%'}.`),
        node('p',`Maior queda do resultado acumulado no recorte: ${money(m.drawdownResultadosUSD)}. Maior sequência negativa: ${m.maiorSequenciaDiasNegativos} datas registradas. Não representa drawdown de equity nem perdas intradiárias.`),
        node('h3','Acertos observáveis'),node('p',m.resultadoLiquidoRegistrado>0?'O saldo dos resultados é positivo neste recorte; isso não comprova vantagem estatística.':'O histórico permite acompanhar perdas e revisar a execução com evidências.'),
        node('h3','Pontos a revisar'),node('p',`Compare os resultados com os limites diários configurados. Lucro não prova boa execução, e prejuízo não prova erro. ${selected.registros.filter(i=>!i.contexto.trim()).length} lançamentos sem contexto detalhado. Sem entradas, stops, saídas, risco e custos por operação, não é possível calcular R, payoff ou expectativa por trade.`),
        node('h3','Próximas melhorias'));
      const list=node('ol');for(const text of ['Configure Stop Loss e Stop Win antes da sessão e registre se voltou a operar após atingir os limites.','Documente tese, invalidação, risco planejado e execução real em cada operação.','Teste uma mudança de processo por vez e compare amostras equivalentes por par, sessão e setup. Trate padrões como hipóteses.'])list.append(node('li',text));diagnostic.append(list);
    }
    for(const control of [prepareButton,copyButton,saveButton])control.disabled=!m.lancamentos;
    if(snapshot&&snapshot!==JSON.stringify(selected))message('Os filtros mudaram. Prepare uma nova solicitação antes de salvar a resposta.');
  };
  for(const control of [broker,resultFilter,month])control.addEventListener('change',update);
  button('Limpar filtros',()=>{broker.value='';resultFilter.value='';month.value='';update();},grid);update();
  const automatic=node('details');automatic.append(node('summary','Integração opcional · gerar análise pela API OpenAI'));content.append(automatic);
  automatic.append(node('p','Esta opção exige chave e créditos da API OpenAI. O recorte será enviado em texto legível ao Supabase Edge Function e à OpenAI. A resposta será criptografada e salva no diário.'));
  const f=node('form');automatic.append(f);
  const consent=input('Autorizo enviar o recorte selecionado ao Supabase Edge Function e à OpenAI para esta análise.','checkbox','',f);
  submit('Gerar análise com ChatGPT',f,async()=>{
    if(!consent.checked)throw new Error('Confirme o envio dos dados para esta análise.');
    if(pendingReview)throw new Error('Salve a análise pendente antes de gerar outra análise.');
    const contexto=structuredClone(context());if(!contexto.registros.length)throw new Error('Nenhum lançamento selecionado.');
    message('Gerando análise. Aguarde e mantenha a sessão aberta...');consent.checked=false;
    const result=await analyze(contexto);
    pendingReview={id:crypto.randomUUID(),data:new Date().toISOString(),contexto:JSON.stringify(contexto),texto:result.texto,modelo:result.modelo};
    await persistReview();
  });
  if(pendingReview){
    const pending=card('Análise gerada, aguardando salvamento');pending.append(node('p','O salvamento anterior falhou. Tente novamente sem fazer outra chamada à IA.'));
    pending.append(node('pre',pendingReview.texto));button('Salvar análise pendente',()=>void run(persistReview),pending);
  }
  for(const r of vault!.diary.revisoes.slice().reverse()){
    const detail=node('details'),title=node('summary',`${new Date(r.data).toLocaleString('pt-BR')} · ${r.modelo||'Importada'}`);detail.append(title,node('pre',r.texto));
    const source=node('details');source.append(node('summary','Dados analisados'),node('pre',r.contexto));detail.append(source);content.append(detail);
  }
}
async function persistReview(){
  if(!pendingReview)return;const review=pendingReview;
  try{await change(d=>{d.revisoes=[...d.revisoes.filter(r=>r.id!==review.id),review].slice(-20);});pendingReview=null;render();message('Análise registrada e criptografada no Supabase.');}
  catch(e){render();throw e;}
}
function evolutionView(){
  const modes=node('nav','','tabs-nav');modes.setAttribute('aria-label','Modalidades da evolução');content.append(modes);
  for(const mode of ['Forex','Opções Binárias'] as const){const b=button(mode,()=>{tradingMode=mode;render();},modes);b.className=`tab-btn${tradingMode===mode?' active':''}`;if(tradingMode===mode)b.setAttribute('aria-current','page');}
  const isOb=tradingMode==='Opções Binárias',diary=vault!.diary,items=isOb?binaryOptions(diary):diary,format=isOb?reais:money;
  const c=card(`Evolução do saldo registrado · ${tradingMode}`),map=new Map<string,number>();
  for(const i of items.movimentos)map.set(i.data,(map.get(i.data)||0)+(i.tipo==='Deposito'?i.valor:-i.valor));
  for(const i of items.dias)map.set(i.data,(map.get(i.data)||0)+i.resultadoFinanceiro);
  let total=0;const points=[...map].sort(([a],[b])=>a.localeCompare(b)).map(([data,v])=>({data,saldo:total+=v}));
  const deposits=items.movimentos.filter(i=>i.tipo==='Deposito').reduce((s,i)=>s+i.valor,0),withdrawals=items.movimentos.filter(i=>i.tipo==='Saque').reduce((s,i)=>s+i.valor,0);
  summaryCards([['Total Depósitos',format(deposits)],['Total Saques',format(withdrawals)],['Saldo registrado',format(total),total]],c);
  c.append(node('p','Inclui depósitos, saques e resultados, sem posições abertas.'));
  const chart=node('div','','evolution-chart');c.append(chart);
  if(!points.length)chart.append(node('p','Registre depósitos, saques ou resultados para visualizar a evolução.'));
  else{
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 900 330');svg.setAttribute('role','img');svg.setAttribute('aria-label',`Evolução do saldo ${tradingMode} em ${isOb?'BRL':'USD'}, de ${points[0].data} a ${points[points.length-1].data}`);chart.append(svg);
    const add=(tag:string,attrs:Record<string,string>,text?:string)=>{const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attrs))el.setAttribute(key,value);if(text!==undefined)el.textContent=text;svg.append(el);return el;};
    const values=points.map(p=>p.saldo),minimum=Math.min(0,...values),maximum=Math.max(0,...values),span=Math.max(1,maximum-minimum),padding=span*.1,min=minimum-padding,max=maximum+padding;
    const x=(i:number)=>80+i*790/Math.max(1,points.length-1),y=(value:number)=>275-(value-min)*225/(max-min);
    for(let i=0;i<=4;i++){const value=min+(max-min)*i/4,yy=y(value);add('line',{x1:'80',x2:'870',y1:String(yy),y2:String(yy),class:'chart-grid'});add('text',{x:'70',y:String(yy+4),'text-anchor':'end',class:'chart-label'},format(value));}
    add('line',{x1:'80',x2:'870',y1:String(y(0)),y2:String(y(0)),class:'chart-zero'});
    const coordinates=points.map((p,i)=>`${x(i)},${y(p.saldo)}`).join(' ');
    if(points.length>1)add('polyline',{points:coordinates,class:'chart-line'});
    for(const [i,p] of points.entries()){const dot=add('circle',{cx:String(x(i)),cy:String(y(p.saldo)),r:points.length>30?'3':'5',class:'chart-point',tabindex:'0'});const title=document.createElementNS('http://www.w3.org/2000/svg','title');title.textContent=`${p.data}: ${format(p.saldo)}`;dot.append(title);}
    const labels=[0,Math.floor((points.length-1)/2),points.length-1].filter((v,i,a)=>a.indexOf(v)===i);
    for(const i of labels)add('text',{x:String(x(i)),y:'315','text-anchor':i===0?'start':i===points.length-1?'end':'middle',class:'chart-date'},new Date(`${points[i].data}T12:00:00`).toLocaleDateString('pt-BR'));
  }
  table(['Data','Saldo'],points.map(i=>[i.data,format(i.saldo)]),c);
}
function backupView(){
  const c=card('Backup criptografado');c.append(node('p','O backup é cifrado e depende da senha do cofre de origem. Guarde os dois separadamente. Não exportamos os registros em texto aberto.'));
  if(vault!.pendingEnvelope)c.append(node('p','Existe uma gravação que falhou. O backup abaixo inclui essa tentativa ainda não salva, para você preservá-la antes de sair.'));
  button('Exportar backup criptografado',()=>download({format:'forex-e2ee-v1',ownerId:vault!.uid,envelope:vault!.pendingEnvelope||vault!.envelope},`forex-cifrado-${new Date().toISOString().slice(0,10)}.json`),c);
  const f=node('form');c.append(f);const file=input('Importar backup criptografado ou JSON antigo','file','',f);file.accept='.json';
  const password=input('Senha do cofre de origem (apenas backup criptografado)','password','',f);password.required=false;password.autocomplete='off';
  submit('Importar e substituir o diário',f,async()=>{
    const source=file.files?.[0];if(!source||source.size>6000000)throw new Error('Selecione um backup JSON de até 6 MB.');
    const data=JSON.parse(await source.text());let imported:Diary;
    if(data.format==='forex-e2ee-v1'){
      validateEnvelope(data.envelope);const secret=password.value;password.value='';const opened=await unlockVault(data.ownerId,secret,data.envelope);validateDiary(opened.value);imported=opened.value;
    }else imported=importLegacy(data);
    if(!confirm('Substituir o diário atual pelo backup? Exporte uma cópia do cofre atual antes de prosseguir.'))return;
    await change(d=>{Object.assign(d,imported);});
  });
  c.append(node('p','Backups antigos podem conter texto aberto. Eles são lidos somente no navegador e criptografados antes de qualquer salvamento no Supabase. Registros de outras modalidades não são convertidos para USD.'));
}

async function start(){
  shell('📈 Diário de Trading Forex');message('Carregando sessão...');
  try{
    const {data,error}=await supabase.auth.getSession();
    if(error)throw error;
    if(configured&&data.session)await vaultGate();else login();
  }catch{login();message('Não foi possível restaurar a sessão. Entre novamente.');}
}
initializePwa();
void start();
