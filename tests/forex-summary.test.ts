import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {expect,it} from 'vitest';
import {emptyDiary,forexSummary,type Diary,type TradeDay} from '../shared/domain';

const html=readFileSync(new URL('../opcoes-binarias.html',import.meta.url),'utf8');
function legacyFunction(name:string){
  const start=html.indexOf(`    function ${name}(`);
  const end=html.indexOf('\n    function ',start+1);
  return html.slice(start,end);
}
function legacyPercentages(d:Diary,items:TradeDay[]){
  return runInNewContext(`${legacyFunction('obterSaldoAntesDoResultado')}
    ${legacyFunction('calcularPercentualForex')}
    ${legacyFunction('calcularMediaDiariaForex')}
    [calcularPercentualForex(itens),calcularMediaDiariaForex(itens)]`,
  {transacoes:d.movimentos,lancamentosForex:d.dias,itens:items});
}
function day(id:string,data:string,result:number,broker='A'):TradeDay{
  return {id,data,corretora:broker,resultadoFinanceiro:result,operacoes:2,wins:1,losses:1,observacao:'',contexto:''};
}
function diary(){
  return {...emptyDiary(),corretoras:['A'],movimentos:[
    {id:'deposit',corretora:'A',data:'2026-10-01',tipo:'Deposito' as const,valor:1000},
    {id:'deposit-2',corretora:'A',data:'2026-10-03',tipo:'Deposito' as const,valor:500},
    {id:'withdrawal',corretora:'A',data:'2026-10-03',tipo:'Saque' as const,valor:200},
  ],dias:[day('1','2026-10-01',100),day('2','2026-10-01',-50),day('3','2026-10-02',0),day('4','2026-10-03',150)]};
}
it('usa os nove indicadores do HTML e conta lançamentos com lucro, prejuízo e zero',()=>{
  const d=diary(),summary=forexSummary(d,d.dias);
  expect(summary).toMatchObject({diasLancados:4,diasWin:2,diasLoss:1,diasZero:1,operacoes:8,taxaAcerto:50,resultado:200});
  expect(summary.percentualAcumulado).toBeCloseTo(200/1500*100);
  expect(summary.percentualMedio).toBeCloseTo((200/1500*100)/3);
});
it.each(['todos','lucro','prejuizo','zero','periodo','segundo-no-dia'])('confere percentuais com as funções originais do HTML: %s',filter=>{
  const d=diary();
  const items=d.dias.filter(i=>filter==='lucro'?i.resultadoFinanceiro>0:filter==='prejuizo'?i.resultadoFinanceiro<0:filter==='zero'?i.resultadoFinanceiro===0:filter==='periodo'?i.data>='2026-10-02':filter==='segundo-no-dia'?i.id==='2':true);
  const [gain]=legacyPercentages(d,items),actual=forexSummary(d,items);
  expect(actual.percentualAcumulado).toBeCloseTo(gain);
  expect(actual.percentualMedio).toBeCloseTo(gain/new Set(items.map(i=>i.data)).size);
});
it('mostra percentuais zero sem lançamentos e indefinidos com várias corretoras ou sem saldo',()=>{
  const d=diary();
  expect(forexSummary(d,[])).toMatchObject({diasLancados:0,taxaAcerto:0,percentualAcumulado:0,percentualMedio:0});
  const mixed=[...d.dias,day('5','2026-10-03',10,'B')];
  const mixedSummary=forexSummary({...d,dias:mixed},mixed);
  expect(mixedSummary).toMatchObject({variasCorretoras:true,percentualAcumulado:null});
  expect(mixedSummary.percentualMedio).toBeNull();
  expect(forexSummary({...d,movimentos:[]},d.dias)).toMatchObject({percentualAcumulado:null,percentualMedio:null});
});
it('calcula a média diária entre corretoras usando o saldo de cada uma',()=>{
  const d=diary();
  d.movimentos.push({id:'deposit-b',corretora:'B',data:'2026-10-01',tipo:'Deposito',valor:200});
  d.dias.push(day('5','2026-10-01',20,'B'));
  const summary=forexSummary(d,d.dias);
  expect(summary.percentualAcumulado).toBeNull();
  expect(summary.percentualMedio).toBeCloseTo((200/1500*100+20/200*100)/4);
});
it('não infla a média quando o saldo de um dia fica negativo',()=>{
  const d=diary();
  d.dias.push(day('5','2026-10-04',-1600));
  d.dias.push(day('6','2026-10-05',20));
  const summary=forexSummary(d,d.dias);
  expect(summary.percentualMedio).toBeCloseTo((-1380/1500*100)/5);
});
it('mantém ordem de criação para UUIDs no mesmo dia e usa o histórico oculto pelo filtro',()=>{
  const d=diary();d.dias=[day('uuid-z','2026-10-01',100),day('uuid-a','2026-10-01',-50)];
  const summary=forexSummary(d,[d.dias[1]]);
  expect(summary.percentualAcumulado).toBeCloseTo(-50/1100*100);
  expect(summary.percentualMedio).toBeCloseTo((-50/1100*100));
});
