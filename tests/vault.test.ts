import {it,expect,vi,beforeEach} from 'vitest';
const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({rpc})}));
import {Vault} from '../frontend/src/api';
import {createVault} from '../frontend/src/crypto';
import {emptyDiary} from '../shared/domain';
beforeEach(()=>rpc.mockReset());
it('envia apenas envelope criptografado e usa controle de versão',async()=>{
  const d=emptyDiary(),c=await createVault('user-a','uma-senha-forte-e-separada',d),v=new Vault('user-a',1,c.envelope,c.key,d);
  rpc.mockResolvedValue({data:2,error:null});const next={...d,corretoras:['DADO-PRIVADO']};await v.save(next);
  expect(rpc.mock.calls[0][1].p_expected_revision).toBe(1);
  expect(JSON.stringify(rpc.mock.calls)).not.toContain('DADO-PRIVADO');
  expect(v.revision).toBe(2);expect(v.diary).toEqual(next);
});
it('não sobrescreve memória nem versão quando ocorre conflito entre dispositivos',async()=>{
  const d=emptyDiary(),c=await createVault('user-a','uma-senha-forte-e-separada',d),v=new Vault('user-a',1,c.envelope,c.key,d);
  rpc.mockResolvedValue({error:{code:'40001'}});
  await expect(v.save({...d,corretoras:['NOVO']})).rejects.toThrow(/outro dispositivo/);
  expect(v.diary).toEqual(d);expect(v.revision).toBe(1);expect(v.envelope).toEqual(c.envelope);
  expect(v.pendingEnvelope).not.toBeNull();
});
