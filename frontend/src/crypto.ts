const ITERATIONS = 600000;
const enc = new TextEncoder(), dec = new TextDecoder();
export type Cipher = { iv: string; data: string };
export type Envelope = { v: 1; kdf: { name: 'PBKDF2-SHA256'; iterations: 600000; salt: string }; wrappedKey: Cipher; payload: Cipher };
export const b64 = (bytes: Uint8Array) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), c=>c.charCodeAt(0));
const aad = (uid: string, part: string) => enc.encode(`diario-forex:${uid}:v1:${part}`);
async function derive(secret: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2', hash:'SHA-256', salt: salt as BufferSource, iterations:ITERATIONS}, material, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
}
async function seal(key: CryptoKey, bytes: Uint8Array, additionalData: Uint8Array): Promise<Cipher> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const result = await crypto.subtle.encrypt({name:'AES-GCM', iv, additionalData:additionalData as BufferSource, tagLength:128}, key, bytes as BufferSource);
  return {iv:b64(iv), data:b64(new Uint8Array(result))};
}
async function open(key: CryptoKey, value: Cipher, additionalData: Uint8Array) {
  return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM', iv:unb64(value.iv) as BufferSource, additionalData:additionalData as BufferSource, tagLength:128}, key, unb64(value.data) as BufferSource));
}
export function validateEnvelope(x: unknown): asserts x is Envelope {
  const e = x as Envelope;
  if (!e || e.v !== 1 || e.kdf?.name !== 'PBKDF2-SHA256' || e.kdf.iterations !== ITERATIONS || typeof e.kdf.salt !== 'string' || unb64(e.kdf.salt).length !== 16) throw new Error('Formato de criptografia inválido.');
  for (const c of [e.wrappedKey,e.payload]) if (!c || typeof c.iv !== 'string' || typeof c.data !== 'string' || c.data.length > 2800000 || unb64(c.iv).length !== 12 || unb64(c.data).length < 16) throw new Error('Conteúdo criptografado inválido.');
}
export async function createVault(uid: string, secret: string, value: unknown) {
  if (secret.length < 16) throw new Error('Use uma senha do cofre com pelo menos 16 caracteres.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const kek = await derive(secret,salt);
  const wrappedKey = await seal(kek,raw,aad(uid,'key'));
  const key = await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
  raw.fill(0);
  const envelope: Envelope = { v:1, kdf:{name:'PBKDF2-SHA256',iterations:ITERATIONS,salt:b64(salt)}, wrappedKey, payload:await seal(key,enc.encode(JSON.stringify(value)),aad(uid,'data')) };
  return {key,envelope};
}
export async function unlockVault(uid: string, secret: string, envelope: Envelope) {
  validateEnvelope(envelope);
  try {
    const kek = await derive(secret,unb64(envelope.kdf.salt));
    const raw = await open(kek,envelope.wrappedKey,aad(uid,'key'));
    const key = await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
    raw.fill(0);
    const value: unknown = JSON.parse(dec.decode(await open(key,envelope.payload,aad(uid,'data'))));
    return {key,value};
  } catch { throw new Error('Senha do cofre incorreta ou conteúdo adulterado. Nenhum dado foi alterado.'); }
}
export async function encryptVault(uid: string, key: CryptoKey, previous: Envelope, value: unknown): Promise<Envelope> {
  return { ...previous, payload: await seal(key,enc.encode(JSON.stringify(value)),aad(uid,'data')) };
}
