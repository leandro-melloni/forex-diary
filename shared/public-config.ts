export function isPublicSupabaseKey(key:string): boolean {
  if(key.startsWith('sb_publishable_'))return key.length>25;
  try {
    const part=key.split('.')[1];
    const payload=JSON.parse(atob(part.replace(/-/g,'+').replace(/_/g,'/')));
    return payload.role==='anon';
  } catch { return false; }
}
export const isSupabaseUrl=(url:string)=>/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url);
