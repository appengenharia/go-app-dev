import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { registrarAcesso, loginAuditado, criarPainelAcessos } from '../acessos.mjs';
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const settle=async()=>{for(let i=0;i<5;i++) await new Promise(r=>setImmediate(r));};

for(const temporary of [false,true]) test(`login explícito ${temporary?'senha_temp':'normal'} gera um único evento`,async()=>{
  let calls=0,logs=[];
  const controls={loginEmail:{value:'teste@example.test'},loginPass:{value:'senha'},btnLogin:{}};
  const code=source.slice(source.indexOf('  async function login()'),source.indexOf('  async function logout()'));
  const sandbox={
    $:id=>controls[id],setMsg:()=>{},lastMainLoginPassword:'',auth:{},db:{},
    getDocs:async()=>({empty:false,docs:[{data:()=>({senha_temp:'temporaria'})}]}),query:()=>{},collection:()=>{},where:()=>{},limit:()=>{},
    signInPrincipal:(...args)=>loginAuditado({signIn:async()=>{calls++;if(temporary&&calls===1)throw {code:'auth/invalid-credential'};return {user:{uid:'u'}};},registrar:uid=>logs.push(uid)},...args),
  };
  await vm.runInNewContext(code+'\nlogin()',sandbox); await settle();
  assert.equal(calls,temporary?2:1); assert.deepEqual(logs,['u']);
});
test('restauração de sessão e authAux não chamam auditoria de login',()=>{
  const start=source.indexOf('  onAuthStateChanged(auth,');
  const callback=source.slice(start,source.indexOf('  initOffline();',start));
  assert.doesNotMatch(callback,/registrarAcesso|signInPrincipal|loginAuditado/);
  assert.doesNotMatch(source,/signInPrincipal\(authAux/);
  assert.equal((source.match(/await signInPrincipal\(auth/g)||[]).length,2);
});
test('registro de acesso contém apenas campos mínimos e falha não impede login',async()=>{
  let written;
  const sdk={getDoc:async()=>({exists:()=>true,data:()=>({role:'VISITANTE',senha_temp:'nunca-gravar'})}),doc:()=>{},collection:()=>{},serverTimestamp:()=> 'server',addDoc:async(_,data)=>{written=data;}};
  assert.equal(await registrarAcesso({sdk,db:{},uid:'u'}),true);
  assert.deepEqual(written,{uid:'u',role:'VISITANTE',obraId:'',evento:'login',criadoEm:'server'});
  sdk.addDoc=async()=>{throw new Error('offline');};
  assert.equal(await registrarAcesso({sdk,db:{},uid:'u'}),false);
  assert.equal((await loginAuditado({signIn:async()=>({user:{uid:'u'}}),registrar:async()=>{throw new Error('offline');}})).user.uid,'u');
  await settle();
});
test('painel ADMIN consulta últimos 100, filtra perfis e escapa nomes',async()=>{
  const dom=new JSDOM('<div id="host"></div>'),host=dom.window.document.querySelector('#host'); let role='ADMIN',queries=[];
  const events=[{uid:'v',role:'VISITANTE',obraId:'o',criadoEm:{toDate:()=>new Date(2026,8,17)}},{uid:'u',role:'USER',obraId:''}];
  const sdk={collection:(_,name)=>name,orderBy:(...x)=>x,limit:n=>({limit:n}),query:(...x)=>{queries.push(x);return x;},getDocs:async()=>({docs:events.map(e=>({data:()=>e}))}),doc:(_,c,id)=>c+'/'+id,getDoc:async ref=>({exists:()=>ref!=='usuarios/u',data:()=>({nome:ref==='usuarios/v'?'<img src=x>':'Obra UFV'})})};
  const load=criarPainelAcessos({sdk,db:{},getRole:()=>role}); await load(host);
  const details=host.querySelector('details');
  assert.equal(details.open,false);
  assert.equal(host.querySelector('summary').textContent,'Acessos recentes');
  assert.equal(host.querySelector('select').value,'VISITANTE');
  assert.deepEqual([...host.querySelectorAll('option')].map(o=>o.textContent),['Visitantes','Todos','Colaboradores','Administradores']);
  assert.equal(queries.length,0);
  details.open=true; details.dispatchEvent(new dom.window.Event('toggle')); await settle();
  assert.equal(queries.length,1);
  assert.deepEqual(queries[0],['acessos',['criadoEm','desc'],{limit:100}]);
  assert.match(host.textContent,/<img src=x>/); assert.equal(host.querySelector('img'),null);
  assert.match(host.textContent,/Obra UFV/); assert.doesNotMatch(host.textContent,/Colaborador · u/);
  host.querySelector('select').value=''; host.querySelector('select').dispatchEvent(new dom.window.Event('change'));
  assert.match(host.textContent,/Colaborador · u/);
  for(const [filter,text] of [['USER','Colaborador · u'],['ADMIN','Nenhum acesso neste filtro.'],['VISITANTE','Visitante · <img src=x>']]) {
    host.querySelector('select').value=filter; host.querySelector('select').dispatchEvent(new dom.window.Event('change'));
    assert.match(host.textContent,new RegExp(text));
  }
  details.open=false; details.dispatchEvent(new dom.window.Event('toggle')); await settle();
  details.open=true; details.dispatchEvent(new dom.window.Event('toggle')); await settle();
  assert.equal(queries.length,1);
  host.querySelector('button').click(); await settle(); assert.equal(queries.length,2);
  await load(host); assert.equal(host.querySelector('details').open,false); assert.equal(queries.length,2);
  for(role of ['VISITANTE','USER']) {
    await load(host); assert.equal(host.hidden,true); assert.equal(host.textContent,''); assert.equal(queries.length,2);
  }
});

test('lazy load mantém carregamento, evita consultas simultâneas e permite recuperar erro',async()=>{
  const dom=new JSDOM('<div id="host"></div>'),host=dom.window.document.querySelector('#host');
  let calls=0, reject;
  const sdk={collection:()=>{},orderBy:()=>{},limit:()=>{},query:()=>{},getDocs:()=>{calls++;return new Promise((_,r)=>{reject=r;});}};
  await criarPainelAcessos({sdk,db:{},getRole:()=> 'ADMIN'})(host);
  const details=host.querySelector('details');
  details.open=true; details.dispatchEvent(new dom.window.Event('toggle'));
  assert.match(host.textContent,/Carregando acessos…/);
  details.dispatchEvent(new dom.window.Event('toggle')); assert.equal(calls,1);
  host.querySelector('select').dispatchEvent(new dom.window.Event('change'));
  assert.match(host.textContent,/Carregando acessos…/);
  reject(new Error('offline')); await settle();
  assert.match(host.textContent,/Não foi possível carregar os acessos. Tente atualizar./);
  sdk.getDocs=async()=>{calls++;return {docs:[]};};
  host.querySelector('button').click(); await settle();
  assert.equal(calls,2); assert.match(host.textContent,/Nenhum acesso neste filtro./);
});

test('Visitante remove resumo residual e mantém KPIs; Evolução preserva resumo',()=>{
  assert.doesNotMatch(source,/_epResumo\(["']v["']\)/);
  const code=source.slice(source.indexOf('  function _vRenderKpis()'),source.indexOf('  function _vRenderListaUnidades()'));
  const ids=['vPctGlobal','vTotalUnids','vLblUnids','vConcluidas','vEmAndamento','vBarPct','vBarFill','vDataAtualizacao'];
  const dom=new JSDOM('<div id="epResumo_v"></div>'+ids.map(id=>`<div id="${id}"></div>`).join(''));
  const document=dom.window.document;
  vm.runInNewContext(code+'\n_vRenderKpis(); _vRenderKpis();',{document,$:id=>document.getElementById(id),_vCfg:{unidades:[{id:'a'}]},_vPctGlobal:()=>50,_vPctUnid:()=>50});
  assert.equal(document.getElementById('epResumo_v'),null);
  assert.equal(document.getElementById('vPctGlobal').textContent,'50.0%');
  assert.equal(document.getElementById('vEmAndamento').textContent,'1');
  assert.match(source,/_epResumo\(\);/);
  assert.match(source,/_epUI\.renderSummary\(el,side\);/);
});
