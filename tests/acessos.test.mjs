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
  assert.deepEqual(queries[0],['acessos',['criadoEm','desc'],{limit:100}]);
  assert.match(host.textContent,/<img src=x>/); assert.equal(host.querySelector('img'),null);
  assert.match(host.textContent,/Obra UFV/); assert.doesNotMatch(host.textContent,/Colaborador · u/);
  host.querySelector('select').value=''; host.querySelector('select').dispatchEvent(new dom.window.Event('change'));
  assert.match(host.textContent,/Colaborador · u/);
  role='VISITANTE'; await load(host); assert.equal(host.hidden,true); assert.equal(host.textContent,''); assert.equal(queries.length,1);
});
