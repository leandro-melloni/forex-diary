import { defineConfig,loadEnv } from 'vite';
import { isPublicSupabaseKey,isSupabaseUrl } from './shared/public-config';
export default defineConfig(({mode})=>{
  const env={...loadEnv(mode,'frontend','VITE_'),...process.env};
  const key=env.VITE_SUPABASE_PUBLISHABLE_KEY,url=env.VITE_SUPABASE_URL;
  if(key&&!isPublicSupabaseKey(key))throw new Error('Use somente a chave pública Supabase no frontend. Chaves secret/service-role são proibidas.');
  if(url&&!isSupabaseUrl(url))throw new Error('VITE_SUPABASE_URL deve ser a origem HTTPS do projeto Supabase.');
  return {root:'frontend',build:{outDir:'../dist',emptyOutDir:true,sourcemap:false},server:{port:5173}};
});
