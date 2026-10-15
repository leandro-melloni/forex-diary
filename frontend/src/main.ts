import './style.css';
import { configured, supabase, readVault, writeVault, Vault, analyze } from './api';
import { createVault, unlockVault, validateEnvelope } from './crypto';
import { emptyDiary, validateDiary, importLegacy, metrics, opening, limits, validateStops, type Diary, type TradeDay } from '../../shared/domain';

const root = document.querySelector<HTMLElement>('#app')!;
let vault: Vault | null = null;
let busy = false, tab = 'Diário', idle: ReturnType<typeof setTimeout>;
let pendingReview: { contexto:string; texto:string; modelo:string; id:string; data:string } | null = null;
let editingDay: TradeDay | undefined;
let loginFingerprint: string | null = null;
async function fingerprint(value:string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).join(','); }
const money = (v:number) => v.toLocaleString('pt-BR',{style:'currency',currency:'USD'});
function node<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className='') {
  const el=document.createElement(tag); el.textContent=text; el.className=className; return el;
}
function message(text:string) { const box=document.querySelector('#status'); if (box) box.textContent=text; }
function shell(title:string) {
  root.replaceChildren(node('h1',title));
  const status=node('p','','status'); status.id='status'; status.setAttribute('role','status'); root.append(status);
}
function card(title:string,parent:HTMLElement=root) { const el=node('section','','card'); el.append(node('h2',title)); parent.append(el); return el; }
function button(text:string,handler:()=>void,parent:HTMLElement) { const b=node('button',text); b.type='button'; b.addEventListener('click',handler); parent.append(b); return b; }
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
function resetIdle() { clearTimeout(idle); if(vault)idle=setTimeout(exit,10*60*1000); }
for(const event of ['pointerdown','keydown']) document.addEventListener(event,resetIdle,{passive:true});
supabase.auth.onAuthStateChange((event)=>{ if(event==='SIGNED_OUT'&&vault){vault=null;pendingReview=null;location.reload();} });

function login() {
  shell('Diário Forex privado');
  if(!configured){message('Configure VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no frontend antes de publicar. Consulte o README.');return;}
  const c=card('Entrar'),f=node('form');c.append(f);
  const email=input('E-mail','email','',f);email.autocomplete='username';
  const password=input('Senha de acesso','password','',f);password.autocomplete='current-password';
  submit('Entrar',f,async()=>{
    const secret=password.value;password.value='';
    const {error}=await supabase.auth.signInWithPassword({email:email.value.trim(),password:secret});
    if(error)throw new Error('Não foi possível entrar. Confira as credenciais e tente novamente.');
    loginFingerprint=await fingerprint(secret);
    await vaultGate();
  });
  c.append(node('p','O acesso é criado pelo administrador do projeto. A sessão fica apenas na memória e termina ao recarregar ou fechar a página.'));
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
    loginFingerprint=null;render();resetIdle();
  });
  button('Sair',exit,c);
}

async function change(edit:(d:Diary)=>void) {
  if(!vault)throw new Error('Cofre bloqueado.');
  const next=structuredClone(vault.diary);edit(next);await vault.save(next);editingDay=undefined;render();message('Salvo criptografado no Supabase.');
}
function table(headers:string[],rows:(string|HTMLElement)[][],parent:HTMLElement){
  const wrapper=node('div','','table-wrap'),t=node('table'),head=node('tr');for(const h of headers)head.append(node('th',h));
  const thead=node('thead');thead.append(head);t.append(thead);const body=node('tbody');
  for(const row of rows){const tr=node('tr');for(const value of row){const td=node('td');typeof value==='string'?td.textContent=value:td.append(value);tr.append(td);}body.append(tr);}
  t.append(body);wrapper.append(t);parent.append(wrapper);
  if(!rows.length)parent.append(node('p','Nenhum registro neste recorte.'));
}
function render(){
  if(!vault)return;shell('Diário Forex');
  const bar=node('header');bar.append(node('span','Cofre aberto · dados cifrados no armazenamento'));button('Bloquear e sair',exit,bar);root.append(bar);
  const nav=node('nav');root.append(nav);
  for(const label of ['Diário','Movimentações','Evolução','Revisão do diário','Configurações','Backup']){
    const b=button(label,()=>{if(!busy){tab=label;editingDay=undefined;render();}},nav);b.className=tab===label?'active':'';
  }
  if(tab==='Diário')diaryView(editingDay);if(tab==='Movimentações')movementView();if(tab==='Evolução')evolutionView();
  if(tab==='Revisão do diário')reviewView();if(tab==='Configurações')settingsView();if(tab==='Backup')backupView();
}
function brokers(parent:HTMLElement,all=false){return select('Corretora',[...(all?[['','Todas'] as [string,string]]:[]),...vault!.diary.corretoras.map(n=>[n,n] as [string,string])],parent);}
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
    panel.textContent=`Saldo de abertura: ${money(base)} · Stop Loss: ${money(l.lossUSD)} · Stop Win: ${money(l.winUSD)} · Resultado (prévia): ${money(net)}. `+
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
  const history=card('Histórico diário'),filters=node('div','','grid');history.append(filters);const filterBroker=brokers(filters,true),month=input('Mês','month','',filters);month.required=false;
  const area=node('div');history.append(area);
  const refresh=()=>{area.replaceChildren();const selected=vault!.diary.dias.filter(i=>(!filterBroker.value||i.corretora===filterBroker.value)&&(!month.value||i.data.startsWith(month.value))).sort((a,b)=>b.data.localeCompare(a.data));const m=metrics(selected);area.append(node('p',`${m.dias} datas · ${m.operacoes} operações · acerto ${m.taxaAcerto?.toFixed(2)??'—'}% · resultado ${money(m.resultadoLiquidoRegistrado)}`));
    table(['Data','Corretora','Operações','Wins/Losses','Resultado','Observações','Ações'],selected.map(i=>{
      const actions=node('div','','actions');button('Editar',()=>{if(!busy){editingDay=i;render();}},actions);
      button('Excluir',()=>{if(confirm('Excluir este lançamento?'))void run(()=>change(d=>{d.dias=d.dias.filter(v=>v.id!==i.id);}));},actions);
      return [i.data,i.corretora,String(i.operacoes),`${i.wins}/${i.losses}`,money(i.resultadoFinanceiro),i.observacao,actions];
    }),area);
  };filterBroker.addEventListener('change',refresh);month.addEventListener('change',refresh);refresh();
}
function movementView(){
  const c=card('Depósitos e saques'),f=node('form','','grid');c.append(f);
  if(!vault!.diary.corretoras.length){c.append(node('p','Cadastre uma corretora em Configurações.'));return;}
  const broker=brokers(f),type=select('Tipo',[['Deposito','Depósito'],['Saque','Saque']],f),date=input('Data','date',new Date().toLocaleDateString('en-CA'),f),value=input('Valor (US$)','number','',f);value.min='.01';value.step='.01';
  submit('Salvar movimento',f,()=>change(d=>{d.movimentos.push({id:crypto.randomUUID(),corretora:broker.value,data:date.value,tipo:type.value as 'Deposito'|'Saque',valor:Number(value.value)});}));
  table(['Data','Corretora','Tipo','Valor','Ação'],vault!.diary.movimentos.slice().sort((a,b)=>b.data.localeCompare(a.data)).map(i=>{const a=node('div');button('Excluir',()=>{if(confirm('Excluir este movimento? Isso recalculará os saldos de abertura.'))void run(()=>change(d=>{d.movimentos=d.movimentos.filter(v=>v.id!==i.id);}));},a);return[i.data,i.corretora,i.tipo,money(i.valor),a];}),c);
}
function settingsView(){
  const c=card('Configuração geral de Stop Loss e Stop Win'),f=node('form','','grid');c.append(f);
  const s=vault!.diary.stops,unit=select('Unidade',[['percentual','% do saldo de abertura'],['usd','US$ fixos']],f);unit.value=s?.unidade||'percentual';
  const loss=input('Stop Loss diário','number',String(s?.loss??''),f),win=input('Stop Win diário','number',String(s?.win??''),f);for(const i of [loss,win]){i.min='.01';i.step='.01';}
  submit('Salvar configuração geral',f,()=>change(d=>{const stops={unidade:unit.value as 'percentual'|'usd',loss:Number(loss.value),win:Number(win.value),configuradoEm:new Date().toISOString()};validateStops(stops);d.stops=stops;}));
  c.append(node('p','Aplicada a todas as corretoras e datas. Consultas antigas usam a regra atual e não comprovam quais limites existiam na época.'));
  const b=card('Corretoras Forex'),bf=node('form','','grid');b.append(bf);const name=input('Nome da corretora','text','',bf);name.maxLength=200;
  submit('Cadastrar',bf,()=>change(d=>{const n=name.value.trim().toUpperCase();if(!n||d.corretoras.includes(n))throw new Error('Informe uma corretora nova.');d.corretoras.push(n);}));
  for(const n of vault!.diary.corretoras){const p=node('p',`${n} · USD`);button('Remover',()=>void run(()=>change(d=>{if(d.dias.some(i=>i.corretora===n)||d.movimentos.some(i=>i.corretora===n))throw new Error('A corretora possui registros.');d.corretoras=d.corretoras.filter(v=>v!==n);})),p);b.append(p);}
}
function reviewView(){
  const c=card('Revisão do diário'),f=node('form','','grid');c.append(f);const broker=brokers(f,true),month=input('Mês','month','',f);month.required=false;
  const consent=input('Autorizo enviar o recorte descriptografado ao Supabase Edge Function e à OpenAI para esta análise.','checkbox','',f);consent.required=true;
  c.append(node('p','Este envio sai do fluxo de armazenamento ponta a ponta: o backend e a OpenAI recebem o recorte em texto legível durante o processamento. O backend não o grava. A resposta volta ao navegador e é criptografada antes de ser salva. Mantenha esta sessão aberta até concluir.'));
  const summary=node('p');c.append(summary);
  const selected=()=>vault!.diary.dias.filter(i=>(!broker.value||i.corretora===broker.value)&&(!month.value||i.data.startsWith(month.value)));
  const update=()=>{const m=metrics(selected());summary.textContent=`${m.dias} datas · ${m.operacoes} operações · resultado ${money(m.resultadoLiquidoRegistrado)} · queda máxima do resultado acumulado: ${money(m.drawdownResultadosUSD)}. Não representa drawdown da equity.`;};broker.addEventListener('change',update);month.addEventListener('change',update);update();
  submit('Gerar análise com ChatGPT',f,async()=>{
    if(!consent.checked)throw new Error('Confirme o envio dos dados para esta análise.');
    const d=vault!.diary,registros=structuredClone(selected());if(!registros.length)throw new Error('Nenhum lançamento selecionado.');
    const contexto={filtros:{corretora:broker.value||'todas',mes:month.value},configuracaoGeralStops:d.stops,registros,
      limitesDiarios:Object.fromEntries(registros.map(i=>[JSON.stringify([i.corretora,i.data]),limits(d,i.corretora,i.data)]))};
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
    const source=node('details');source.append(node('summary','Dados analisados'),node('pre',r.contexto));detail.append(source);root.append(detail);
  }
}
async function persistReview(){
  if(!pendingReview)return;const review=pendingReview;
  try{await change(d=>{d.revisoes=[...d.revisoes.filter(r=>r.id!==review.id),review].slice(-20);});pendingReview=null;render();message('Análise registrada e criptografada no Supabase.');}
  catch(e){render();throw e;}
}
function evolutionView(){
  const c=card('Evolução do saldo registrado'),map=new Map<string,number>();
  for(const i of vault!.diary.movimentos)map.set(i.data,(map.get(i.data)||0)+(i.tipo==='Deposito'?i.valor:-i.valor));
  for(const i of vault!.diary.dias)map.set(i.data,(map.get(i.data)||0)+i.resultadoFinanceiro);
  let total=0;const points=[...map].sort(([a],[b])=>a.localeCompare(b)).map(([data,v])=>({data,saldo:total+=v}));
  c.append(node('p',`Saldo registrado: ${money(total)}. Inclui depósitos, saques e resultados, sem posições abertas.`));
  const canvas=node('canvas');canvas.width=900;canvas.height=300;canvas.setAttribute('aria-label','Evolução do saldo Forex em USD');c.append(canvas);const ctx=canvas.getContext('2d');
  if(ctx&&points.length){const min=Math.min(0,...points.map(i=>i.saldo)),max=Math.max(1,...points.map(i=>i.saldo));ctx.strokeStyle='#2878ad';ctx.lineWidth=3;ctx.beginPath();points.forEach((p,i)=>{const x=25+i*850/Math.max(1,points.length-1),y=275-(p.saldo-min)*250/(max-min);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();}
  table(['Data','Saldo'],points.map(i=>[i.data,money(i.saldo)]),c);
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

login();
