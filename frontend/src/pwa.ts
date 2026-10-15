type InstallEvent=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:string}>};
let installEvent:InstallEvent|null=null;
const standalone=()=>window.matchMedia('(display-mode: standalone)').matches||(navigator as Navigator&{standalone?:boolean}).standalone===true;
export function initializePwa(){
  window.addEventListener('beforeinstallprompt',event=>{
    event.preventDefault();installEvent=event as InstallEvent;
    document.querySelectorAll<HTMLButtonElement>('.install-native').forEach(button=>{button.hidden=false;});
  });
  window.addEventListener('appinstalled',()=>{
    installEvent=null;document.querySelectorAll('.install-help').forEach(el=>el.remove());
  });
  if(import.meta.env.PROD&&'serviceWorker' in navigator){
    void navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).catch(()=>{
      document.querySelectorAll<HTMLElement>('.install-feedback').forEach(el=>{el.textContent='A instalação não está disponível agora. Você pode continuar usando pelo navegador.';});
    });
  }
  const updateConnection=()=>document.querySelectorAll<HTMLElement>('.connection-status').forEach(el=>{el.hidden=navigator.onLine;});
  window.addEventListener('online',updateConnection);window.addEventListener('offline',updateConnection);
}
export function installWidget(){
  if(standalone())return null;
  const details=document.createElement('details');details.className='install-help';
  const title=document.createElement('summary');title.textContent='Instalar no celular';
  const description=document.createElement('p');description.textContent='Adicione o Diário Forex à tela inicial e abra como aplicativo. É necessário estar conectado à internet para acessar seus dados.';
  const android=document.createElement('p');android.textContent='Android: no Chrome, abra o menu ⋮ e escolha “Instalar aplicativo” ou “Adicionar à tela inicial”.';
  const ios=document.createElement('p');ios.textContent='iPhone: abra no Safari, toque em Compartilhar e depois em “Adicionar à Tela de Início”. Ative “Abrir como App da Web”, se aparecer.';
  const button=document.createElement('button');button.type='button';button.className='install-native';button.textContent='Instalar aplicativo';button.hidden=!installEvent;
  const feedback=document.createElement('p');feedback.className='install-feedback';feedback.setAttribute('role','status');
  button.addEventListener('click',()=>{
    const event=installEvent;if(!event)return;installEvent=null;button.disabled=true;
    void (async()=>{
      try{await event.prompt();const choice=await event.userChoice;feedback.textContent=choice.outcome==='accepted'?'Instalação solicitada. Procure o ícone na sua tela inicial.':'Você pode instalar depois pelo menu do navegador.';}
      catch{feedback.textContent='Use as instruções acima para adicionar à tela inicial.';}
      finally{button.hidden=true;button.disabled=false;}
    })();
  });
  details.append(title,description,button,android,ios,feedback);return details;
}
