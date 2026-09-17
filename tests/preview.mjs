import { criarInterface } from '../evolucao-parametrizada-ui.mjs';
import { calcular } from '../evolucao-parametrizada.mjs';
import { config, autorizado } from './fixture.mjs';
const docs=new Map([['obras/obra/evolConfig/main',config()],['usuarios/autor',autorizado]]);
const db={}, context={db,obraId:'obra',cfg:config(),user:{uid:'autor'},profile:autorizado};
let seq=0, state=calcular(context.cfg,[]);
const offline=()=>{if(document.getElementById('offline').checked)throw new Error('Sem rede simulada. Seus dados continuam no formulário.');};
const sdk={
  collection:(base,...parts)=>({path:[base.path,...parts].filter(Boolean).join('/')}),
  doc:(base,...parts)=>{const id=parts.at(-1)||'fake'+(++seq);return {path:[base.path,...(parts.length?parts:[id])].filter(Boolean).join('/'),id};},
  serverTimestamp:()=>({seconds:Math.floor(Date.now()/1000)}),
  getDocsFromServer:async ref=>{offline();return {docs:[...docs].filter(([p])=>p.startsWith(ref.path+'/')&&p.split('/').length===ref.path.split('/').length+1).map(([p,v])=>({id:p.split('/').at(-1),data:()=>v}))};},
  runTransaction:async(_,fn)=>{offline();const writes=[];await fn({get:async ref=>({exists:()=>docs.has(ref.path),data:()=>docs.get(ref.path)}),set:(ref,v)=>writes.push([ref.path,v])});writes.forEach(([p,v])=>docs.set(p,v));},
};
function summary(){
  document.getElementById('global').textContent=`Avanço da obra: ${state?.global.toFixed(2)||'0'}%`;
  ui.renderSummary(document.getElementById('resumo'));
}
const ui=criarInterface({sdk,getContext:()=>context,getState:()=>state,refresh:async()=>{
  context.cfg=docs.get('obras/obra/evolConfig/main');state=calcular(context.cfg,await ui.carregarRegistros(db,'obra'));summary();
},uploadPhoto:async file=>{offline();return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});}});
document.getElementById('perfil').onchange=e=>{context.profile={...autorizado,role:e.target.value};docs.set('usuarios/autor',context.profile);summary();};
document.getElementById('local').onclick=()=>ui.openUnit(context.cfg.unidades[0].id);
document.getElementById('config').onclick=()=>{try{ui.openConfig();}catch(e){document.getElementById('erro').textContent=e.message;}};
document.getElementById('novo').onclick=()=>{
  if(context.profile.role!=='ADMIN')return;
  docs.clear();docs.set('usuarios/autor',context.profile);context.cfg=null;state=null;ui.openConfig();
};
summary();
