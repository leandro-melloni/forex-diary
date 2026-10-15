import { createClient } from '@supabase/supabase-js';
import { encryptVault, type Envelope } from './crypto';
import { validateDiary, type Diary, type TradeDay } from '../../shared/domain';
import { isPublicSupabaseKey, isSupabaseUrl } from '../../shared/public-config';
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const publicKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
export const configured = !!url && !!publicKey && isSupabaseUrl(url) && isPublicSupabaseKey(publicKey);
export const supabase = createClient(configured ? url! : 'https://unconfigured.supabase.co', configured ? publicKey! : 'unconfigured', { auth:{persistSession:true, storage:typeof window === 'undefined' ? undefined : window.sessionStorage, autoRefreshToken:true, detectSessionInUrl:false, flowType:'pkce'} });
export async function readVault(uid: string) {
  const {data,error} = await supabase.from('encrypted_vaults').select('revision,envelope').eq('user_id',uid).maybeSingle();
  if (error) throw new Error('Não foi possível carregar o cofre. Confira sua sessão e tente novamente.');
  return data as {revision:number; envelope:Envelope} | null;
}
export async function writeVault(revision: number, envelope: Envelope): Promise<number> {
  if (new TextEncoder().encode(JSON.stringify(envelope)).length > 3000000) throw new Error('O cofre excede 3 MB cifrados. Exporte um backup e reduza o histórico antes de salvar.');
  const {data,error} = await supabase.rpc('write_encrypted_vault', {p_expected_revision:revision,p_envelope:envelope});
  if (error?.code === '40001') throw new Error('O diário mudou em outro dispositivo. Exporte um backup e entre novamente antes de continuar.');
  if (error) throw new Error('Não foi possível salvar no Supabase. Seus dados atuais continuam nesta sessão. Tente novamente ou exporte um backup.');
  if (typeof data !== 'number') throw new Error('Resposta de salvamento inválida.');
  return data;
}
export class Vault {
  pendingEnvelope: Envelope | null = null;
  constructor(public uid:string, public revision:number, public envelope:Envelope, private key:CryptoKey, public diary:Diary) {}
  async save(next: Diary) {
    validateDiary(next);
    const encrypted = await encryptVault(this.uid,this.key,this.envelope,next);
    this.pendingEnvelope = encrypted;
    const revision = await writeVault(this.revision,encrypted);
    this.revision = revision; this.envelope = encrypted; this.diary = next;
    this.pendingEnvelope = null;
  }
}
let analysisRetryAt=0;
export async function analyze(contexto: { registros:TradeDay[]; [key:string]:unknown }) {
  if(Date.now()<analysisRetryAt)throw new Error(`Aguarde ${Math.ceil((analysisRetryAt-Date.now())/1000)} segundos antes de tentar novamente.`);
  const { data:sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) throw new Error('Entre novamente para realizar a análise.');
  const {data,error} = await supabase.functions.invoke('analyze-diary', { body:{contexto,consent:true} });
  if (error) {
    let message = 'Falha na análise. Confira a conexão e tente novamente.';
    if ('context' in error && error.context instanceof Response) {
      const body = await error.context.json().catch(()=>null);
      if (typeof body?.erro === 'string') message = body.erro;
      if(error.context.status===429&&typeof body?.retryAfterSeconds==='number'&&Number.isFinite(body.retryAfterSeconds)&&body.retryAfterSeconds>0){
        analysisRetryAt=Date.now()+Math.min(body.retryAfterSeconds,86400)*1000;
      }
    }
    throw new Error(message);
  }
  if (!data || typeof data.texto !== 'string' || !data.texto.trim() || typeof data.modelo !== 'string') throw new Error('Resposta da IA inválida.');
  return data as {texto:string;modelo:string};
}
