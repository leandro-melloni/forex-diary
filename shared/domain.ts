export type TradeDay = { id: string; corretora: string; data: string; operacoes: number; wins: number; losses: number; resultadoFinanceiro: number; observacao: string; contexto: string };
export type Movement = { id: string; corretora: string; data: string; tipo: 'Deposito' | 'Saque'; valor: number };
export type Stops = { unidade: 'percentual' | 'usd'; loss: number; win: number; configuradoEm: string };
export type Review = { id: string; data: string; contexto: string; texto: string; modelo?: string };
export type Diary = { version: 1; corretoras: string[]; dias: TradeDay[]; movimentos: Movement[]; stops: Stops | null; revisoes: Review[] };
export const emptyDiary = (): Diary => ({ version: 1, corretoras: [], dias: [], movimentos: [], stops: null, revisoes: [] });
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const text = (x: unknown, max: number): x is string => typeof x === 'string' && x.length <= max;
const date = (x: unknown): x is string => text(x, 10) && /^\d{4}-\d{2}-\d{2}$/.test(x) && new Date(x).toISOString().slice(0, 10) === x;
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 1e12;
export function validateStops(x: unknown): asserts x is Stops {
  if (!record(x) || !['percentual','usd'].includes(String(x.unidade)) || !finite(x.loss) || !finite(x.win) || x.loss < .01 || x.win < .01 || (x.unidade === 'percentual' && x.loss > 100) || !text(x.configuradoEm, 50)) throw new Error('Limites inválidos.');
}
export function validateDays(x: unknown): asserts x is TradeDay[] {
  if (!Array.isArray(x) || x.length > 5000) throw new Error('Quantidade de lançamentos inválida.');
  for (const i of x) if (!record(i) || !text(i.id, 100) || !text(i.corretora, 200) || !i.corretora || !date(i.data) || !finite(i.resultadoFinanceiro) || ![i.operacoes,i.wins,i.losses].every(v => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 100000) || Number(i.wins) + Number(i.losses) > Number(i.operacoes) || !text(i.observacao, 6000) || !text(i.contexto, 6000)) throw new Error('Lançamento inválido.');
}
export function validateDiary(x: unknown): asserts x is Diary {
  if (!record(x) || x.version !== 1 || !Array.isArray(x.corretoras) || x.corretoras.length > 200 || !x.corretoras.every(v => text(v, 200) && v.trim()) || !Array.isArray(x.movimentos) || x.movimentos.length > 5000 || !Array.isArray(x.revisoes) || x.revisoes.length > 20) throw new Error('Formato de diário inválido.');
  validateDays(x.dias);
  for (const i of x.movimentos) if (!record(i) || !text(i.id,100) || !text(i.corretora,200) || !date(i.data) || !['Deposito','Saque'].includes(String(i.tipo)) || !finite(i.valor) || i.valor <= 0) throw new Error('Movimento inválido.');
  for (const i of x.revisoes) if (!record(i) || !text(i.id,100) || !text(i.data,50) || !text(i.contexto,300000) || !text(i.texto,100000) || (i.modelo !== undefined && !text(i.modelo,100))) throw new Error('Revisão inválida.');
  if (x.stops !== null) validateStops(x.stops);
}
export const round = (n: number) => Math.round(n * 100) / 100;
export function opening(d: Diary, broker: string, day: string): number {
  return round(d.movimentos.filter(i => i.corretora === broker && i.data <= day).reduce((s,i) => s + (i.tipo === 'Deposito' ? i.valor : -i.valor), 0) + d.dias.filter(i => i.corretora === broker && i.data < day).reduce((s,i) => s + i.resultadoFinanceiro,0));
}
export function limits(d: Diary, broker: string, day: string) {
  const saldoBase = opening(d, broker, day);
  if (!d.stops || saldoBase <= 0) return null;
  const { unidade, loss, win } = d.stops;
  return { saldoBase, lossUSD: round(unidade === 'percentual' ? saldoBase * loss / 100 : loss), winUSD: round(unidade === 'percentual' ? saldoBase * win / 100 : win) };
}
export function metrics(dias: TradeDay[]) {
  const grouped = new Map<string,number>();
  for (const d of dias) grouped.set(d.data, (grouped.get(d.data) || 0) + d.resultadoFinanceiro);
  const values = [...grouped].sort(([a],[b]) => a.localeCompare(b)).map(([,v]) => v);
  let total = 0, peak = 0, drawdown = 0, seq = 0, maxSeq = 0;
  for (const v of values) { total += v; peak = Math.max(peak,total); drawdown = Math.max(drawdown,peak-total); seq = v < 0 ? seq+1 : 0; maxSeq = Math.max(maxSeq,seq); }
  const wins = dias.reduce((s,i) => s+i.wins,0), losses = dias.reduce((s,i) => s+i.losses,0);
  const mean = (a: number[]) => a.length ? a.reduce((s,n) => s+n,0)/a.length : null;
  return { lancamentos: dias.length, dias: grouped.size, operacoes: dias.reduce((s,i)=>s+i.operacoes,0), wins, losses, taxaAcerto: wins+losses ? 100*wins/(wins+losses) : null, resultadoLiquidoRegistrado: round(total), drawdownResultadosUSD: round(drawdown), maiorSequenciaDiasNegativos: maxSeq, mediaDiaPositivo: mean(values.filter(v=>v>0)), mediaDiaNegativo: mean(values.filter(v=>v<0)) };
}
// Reproduz o Resumo Forex do HTML legado, sem alterar as métricas da análise por IA.
export function forexSummary(d: Diary, items: TradeDay[]) {
  const order = new Map(d.dias.map((item,index)=>[item.id,index]));
  const compare = (a:TradeDay,b:TradeDay) => a.data.localeCompare(b.data) ||
    (Number.isFinite(Number(a.id))&&Number.isFinite(Number(b.id))?Number(a.id)-Number(b.id):(order.get(a.id)??0)-(order.get(b.id)??0));
  const before = (item:TradeDay) => d.movimentos.filter(i=>i.corretora===item.corretora&&i.data<=item.data)
    .reduce((sum,i)=>sum+(i.tipo==='Deposito'?i.valor:-i.valor),0)+
    d.dias.filter(i=>i.corretora===item.corretora&&i.id!==item.id&&compare(i,item)<0).reduce((sum,i)=>sum+i.resultadoFinanceiro,0);
  const wins=items.reduce((sum,i)=>sum+i.wins,0),losses=items.reduce((sum,i)=>sum+i.losses,0);
  const resultado=items.reduce((sum,i)=>sum+i.resultadoFinanceiro,0);
  const variasCorretoras=new Set(items.map(i=>i.corretora)).size>1;
  let percentualAcumulado:number|null=0,percentualMedio:number|null=0;
  if(variasCorretoras){percentualAcumulado=null;percentualMedio=null;}
  else if(items.length){
    const sorted=[...items].sort(compare),first=sorted[0],last=sorted[sorted.length-1];
    const deposits=d.movimentos.filter(i=>i.corretora===first.corretora&&i.tipo==='Deposito'&&i.data>first.data&&i.data<=last.data).reduce((sum,i)=>sum+i.valor,0);
    const capital=before(first)+deposits;
    percentualAcumulado=capital>0?resultado/capital*100:null;
    const days=new Map<string,number>();
    for(const i of items)days.set(i.data,(days.get(i.data)??0)+i.resultadoFinanceiro);
    let total=0;
    for(const [date,result] of days){
      const firstOfDay=d.dias.filter(i=>i.corretora===first.corretora&&i.data===date).sort(compare)[0];
      const balance=firstOfDay?before(firstOfDay):0;
      if(balance<=0){percentualMedio=null;break;}
      total+=result/balance*100;
    }
    if(percentualMedio!==null)percentualMedio=total/days.size;
  }
  return {diasLancados:items.length,diasWin:items.filter(i=>i.resultadoFinanceiro>0).length,
    diasLoss:items.filter(i=>i.resultadoFinanceiro<0).length,diasZero:items.filter(i=>i.resultadoFinanceiro===0).length,
    operacoes:items.reduce((sum,i)=>sum+i.operacoes,0),taxaAcerto:wins+losses?wins/(wins+losses)*100:0,
    resultado,percentualAcumulado,percentualMedio,variasCorretoras};
}
export function importLegacy(value: unknown): Diary {
  if (!record(value)) throw new Error('Backup inválido.');
  if (value.version === 1) { validateDiary(value); return value; }
  if (!Array.isArray(value.corretoras) || !Array.isArray(value.transacoes)) throw new Error('Backup antigo inválido.');
  const rawDays = Array.isArray(value.lancamentosForex) ? value.lancamentosForex : [];
  const types = record(value.tiposCorretoras) ? value.tiposCorretoras : {};
  const corretoras = value.corretoras.filter((n): n is string => typeof n === 'string' && (types[n] === 'Forex' || rawDays.some(i=>i.corretora===n)));
  const d: Diary = { ...emptyDiary(), corretoras,
    dias: rawDays.map(i=>({id:String(i.id), corretora:i.corretora, data:i.data, operacoes:Number(i.operacoes), wins:Number(i.wins), losses:Number(i.losses), resultadoFinanceiro:Number(i.resultadoFinanceiro), observacao:i.observacao||'', contexto:i.contexto||''})),
    movimentos: value.transacoes.filter(i=>corretoras.includes(i.corretora) && i.moeda !== 'BRL').map(i=>({id:String(i.id), corretora:i.corretora, data:i.data, tipo:i.tipo, valor:Number(i.valor)})),
    revisoes: (Array.isArray(value.relatoriosForexIA) ? value.relatoriosForexIA : []).slice(-20).map(i=>({id:i.id||crypto.randomUUID(),data:i.data,contexto:i.contexto,texto:i.texto,...(i.modelo?{modelo:i.modelo}:{})})) };
  const config = record(value.limitesForex) && record(value.limitesForex.geral) ? value.limitesForex.geral : null;
  if (config) d.stops = { unidade: config.unidade as Stops['unidade'], loss:Number(config.loss), win:Number(config.win), configuradoEm:String(config.configuradoEm||new Date().toISOString()) };
  validateDiary(d); return d;
}
