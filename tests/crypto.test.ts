import { describe,it,expect } from 'vitest';
import { createVault,unlockVault,encryptVault } from '../frontend/src/crypto';
import { emptyDiary } from '../shared/domain';
describe('cofre ponta a ponta',()=>{
  it('cifra sem texto aberto e mantém chave não exportável',async()=>{
    const value={...emptyDiary(),corretoras:['SEGREDO-EXNESS']};
    const created=await createVault('user-a','senha-separada-do-cofre-123',value);
    expect(JSON.stringify(created.envelope)).not.toContain('SEGREDO-EXNESS');
    expect(created.key.extractable).toBe(false);
    expect((await unlockVault('user-a','senha-separada-do-cofre-123',created.envelope)).value).toEqual(value);
    await expect(crypto.subtle.exportKey('raw',created.key)).rejects.toThrow();
  });
  it('rejeita senha incorreta, usuário diferente e adulteração',async()=>{
    const c=await createVault('user-a','uma-senha-forte-e-separada',emptyDiary());
    await expect(unlockVault('user-a','senha-incorreta',c.envelope)).rejects.toThrow();
    await expect(unlockVault('user-b','uma-senha-forte-e-separada',c.envelope)).rejects.toThrow();
    const changed=structuredClone(c.envelope);changed.payload.data=(changed.payload.data[0]==='A'?'B':'A')+changed.payload.data.slice(1);
    await expect(unlockVault('user-a','uma-senha-forte-e-separada',changed)).rejects.toThrow();
  });
  it('usa novo IV em cada atualização e rejeita parâmetros KDF manipulados',async()=>{
    const c=await createVault('user-a','uma-senha-forte-e-separada',emptyDiary());
    const e=await encryptVault('user-a',c.key,c.envelope,emptyDiary());
    expect(e.payload.iv).not.toEqual(c.envelope.payload.iv);
    expect(e.wrappedKey).toEqual(c.envelope.wrappedKey);
    const changed=structuredClone(e);changed.kdf.iterations=1 as 600000;
    await expect(unlockVault('user-a','uma-senha-forte-e-separada',changed)).rejects.toThrow();
  });
});
