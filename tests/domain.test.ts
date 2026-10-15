import {it,expect} from 'vitest';
import { emptyDiary,importLegacy,opening,limits,metrics,validateDiary } from '../shared/domain';
import { isPublicSupabaseKey } from '../shared/public-config';
it('bloqueia chaves privadas no frontend',()=>{
  expect(isPublicSupabaseKey('sb_secret_nao-publicar')).toBe(false);
  const jwt=(role:string)=>'header.'+btoa(JSON.stringify({role}))+'.signature';
  expect(isPublicSupabaseKey(jwt('service_role'))).toBe(false);
  expect(isPublicSupabaseKey(jwt('anon'))).toBe(true);
});
it('importa Forex e preserva separação de BRL sem converter moeda',()=>{
  const d=importLegacy({versao:7,corretoras:['EXNESS','ANTIGA'],tiposCorretoras:{EXNESS:'Forex',ANTIGA:'OB'},
    transacoes:[{id:1,corretora:'EXNESS',data:'2026-10-01',tipo:'Deposito',valor:1000,moeda:'USD'},{id:2,corretora:'ANTIGA',data:'2026-10-01',tipo:'Deposito',valor:9000,moeda:'BRL'}],
    lancamentosForex:[{id:1,corretora:'EXNESS',data:'2026-10-01',operacoes:2,wins:1,losses:1,resultadoFinanceiro:50}],
    limitesForex:{geral:{unidade:'percentual',loss:5,win:15,configuradoEm:'2026-10-15'}}});
  expect(d.corretoras).toEqual(['EXNESS']);expect(d.movimentos).toHaveLength(1);
  expect(opening(d,'EXNESS','2026-10-01')).toBe(1000);
  expect(limits(d,'EXNESS','2026-10-02')).toMatchObject({saldoBase:1050,lossUSD:52.5,winUSD:157.5});
});
it('não confunde operações, datas e drawdown de resultado',()=>{
  const d=emptyDiary();d.dias=[100,-120,-30,80].map((v,i)=>({id:String(i),corretora:'A',data:['2026-10-01','2026-10-01','2026-10-02','2026-10-03'][i],operacoes:1,wins:v>0?1:0,losses:v<0?1:0,resultadoFinanceiro:v,observacao:'',contexto:''}));
  expect(metrics(d.dias)).toMatchObject({dias:3,operacoes:4,resultadoLiquidoRegistrado:30,drawdownResultadosUSD:50,maiorSequenciaDiasNegativos:2});
});
it('rejeita backups inválidos em vez de executar conteúdo',()=>{
  const d=emptyDiary();d.dias=[{id:'a',corretora:'A',data:'2026-10-01',operacoes:1,wins:2,losses:1,resultadoFinanceiro:1,observacao:'',contexto:''}];
  expect(()=>validateDiary(d)).toThrow();
});
