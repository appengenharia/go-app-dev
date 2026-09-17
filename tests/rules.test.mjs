import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import * as sdk from 'firebase/firestore';
import { criarStore } from '../evolucao-parametrizada-store.mjs';
import { calcular, prepararRegistro } from '../evolucao-parametrizada.mjs';
import { config, entrada, autorizado } from './fixture.mjs';

// Proteção contra execução acidental em qualquer projeto real.
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8089') throw new Error('Execute somente pelo emulador local em 127.0.0.1:8089.');
const projectId = 'demo-go-evolucao';
let env;
const cfg = config(), store = criarStore(sdk);
const context = uid => ({ db: env.authenticatedContext(uid).firestore(), user: { uid }, obraId: 'obra', cfg });
const ref = (ctx, id) => sdk.doc(ctx.db,'obras','obra','evolRegistros',id);
const create = (ctx,id,values={}) => store.salvarRegistro(ctx,{id,entrada:entrada(values),operacaoId:'create-'+id});
const get = async (ctx,id) => (await sdk.getDoc(ref(ctx,id))).data();
before(async()=>{
  env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8089,rules:fs.readFileSync(new URL('../firestore.rules',import.meta.url),'utf8')}});
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx=>{
    const db=ctx.firestore();
    const profiles={autor:autorizado,responsavel:{...autorizado,evolResponsavel:true},admin:{role:'ADMIN'},visitante:{...autorizado,role:'VISITANTE'},sem:{...autorizado,permEvolucao:false},outra:{...autorizado,obras:['outra']},inativo:{...autorizado,ativo:false}};
    for(const [uid,p] of Object.entries(profiles)) await sdk.setDoc(sdk.doc(db,'usuarios',uid),p);
    await sdk.setDoc(sdk.doc(db,'obras','obra','evolConfig','main'),cfg);
    await sdk.setDoc(sdk.doc(db,'obras','legado','evolConfig','main'),{servicos:[{id:'s1',peso:10}],unidades:[{id:'u1'}]});
    await sdk.setDoc(sdk.doc(db,'obras','v2antigo','evolConfig','main'),{modeloEvolucao:2,macros:[{id:'m1',percentual:100,micros:[{id:'s1',peso:5,qtdTotal:1}]}],unidades:[{id:'u1'}]});
    await sdk.setDoc(sdk.doc(db,'usuarios','legado'),{...autorizado,obras:['legado','v2antigo']});
  });
});
after(async()=>{ await env?.cleanup(); });

test('criação atômica com auditoria, idempotência e vários dias/lançamentos',async()=>{
  const ctx=context('autor');
  await assertSucceeds(create(ctx,'r1'));
  await assertSucceeds(create(ctx,'r1')); // mesma operação, não duplica
  await create(ctx,'r2',{unidId:'u2',qtdHoje:2});
  const a=await store.carregarAuditoria(ctx.db,'obra','r1');
  assert.equal(a.length,1); assert.equal(a[0].dadosAnteriores,null); assert.equal(a[0].dadosNovos.qtdHoje,1);
  assert.equal(a[0].corrigidoPor,'autor');
  assert.equal(calcular(cfg,await store.carregarRegistros(ctx.db,'obra')).global,13.5);
});
test('autor/responsável corrigem quantidade, local, Micro, observação e cancelam',async()=>{
  const ctx=context('autor'), resp=context('responsavel');
  await create(ctx,'corrigir');
  await assertSucceeds(store.salvarRegistro(resp,{id:'corrigir',revisaoEsperada:1,entrada:entrada({unidId:'u2',svcId:'s2',qtdHoje:10,obs:'Corrigido'}),motivo:'Local e serviço errados',operacaoId:'corrigir-2'}));
  const r=await get(ctx,'corrigir');
  assert.equal(r.criadoPor,'autor'); assert.equal(r.macroId,'m2'); assert.equal(r.corrigidoPor,'responsavel');
  assert.equal(calcular(cfg,[r]).global,73);
  await assertSucceeds(store.salvarRegistro(ctx,{id:'corrigir',revisaoEsperada:2,entrada:r,motivo:'Duplicado',cancelar:true,operacaoId:'cancelar-3'}));
  const cancelado=await get(ctx,'corrigir'); assert.equal(cancelado.cancelado,true); assert.equal(cancelado.qtdHoje,10);
  assert.equal(calcular(cfg,[cancelado]).global,0);
  assert.equal((await store.carregarAuditoria(ctx.db,'obra','corrigir')).length,3);
});
test('troca/remoção individual de fotos preservam documento, quantidade e outra foto',async()=>{
  const ctx=context('autor'); await create(ctx,'fotos',{fotoUrl:'https://example.test/a',fotoUrlDepois:'https://example.test/b'});
  let r=await get(ctx,'fotos');
  await store.salvarRegistro(ctx,{id:'fotos',revisaoEsperada:1,entrada:{...r,fotoUrl:'https://example.test/c'},motivo:'Troca Antes',operacaoId:'foto-2'});
  r=await get(ctx,'fotos'); assert.equal(r.fotoUrlDepois,'https://example.test/b');
  await store.salvarRegistro(ctx,{id:'fotos',revisaoEsperada:2,entrada:{...r,fotoUrl:''},motivo:'Remover Antes',operacaoId:'foto-3'});
  r=await get(ctx,'fotos'); assert.equal(r.qtdHoje,1); assert.equal(r.fotoUrl,''); assert.equal(r.fotoUrlDepois,'https://example.test/b');
  assert.equal((await store.carregarAuditoria(ctx.db,'obra','fotos')).length,3);
});
test('Rules bloqueiam visitante, não autorizado, inativo e outra obra mesmo por SDK direto',async()=>{
  const autor=context('autor'); await create(autor,'seguranca');
  for(const uid of ['visitante','sem','outra','inativo']) {
    const ctx=context(uid);
    await assertFails(sdk.setDoc(ref(ctx,'tentativa-'+uid),{qtdHoje:5}));
    await assertFails(sdk.updateDoc(ref(ctx,'seguranca'),{obs:'adulterado'}));
    await assertFails(sdk.deleteDoc(ref(ctx,'seguranca')));
  }
  await assertSucceeds(sdk.getDoc(ref(context('visitante'),'seguranca')));
  await assertFails(sdk.getDoc(sdk.doc(env.unauthenticatedContext().firestore(),'obras','obra','evolRegistros','seguranca')));
});
test('Rules exigem auditoria e não aceitam campos estruturais/autor forjado',async()=>{
  const ctx=context('autor'); await create(ctx,'adulteracao');
  await assertFails(sdk.updateDoc(ref(ctx,'adulteracao'),{qtdHoje:20}));
  await assertFails(sdk.updateDoc(ref(ctx,'adulteracao'),{fotoUrl:'https://example.test/sem-audit'}));
  for(const patch of [{pesoFisico:100},{criadoPor:'outro'},{data:'2020-01-01'},{qtdHoje:-1},{unidId:'inexistente'}]) {
    const anterior=await get(ctx,'adulteracao');
    const timestamp=sdk.serverTimestamp();
    const pair=prepararRegistro(cfg,anterior,anterior,{uid:'autor',timestamp,motivo:'Forjado'});
    const novo={...pair.registro,...patch};
    const batch=sdk.writeBatch(ctx.db);
    batch.set(ref(ctx,'adulteracao'),novo);
    batch.set(sdk.doc(ref(ctx,'adulteracao'),'auditoria','r2'),{...pair.auditoria,dadosNovos:novo,operacaoId:'forjado'});
    await assertFails(batch.commit());
  }
  assert.equal((await get(ctx,'adulteracao')).revisao,1);
});
test('auditoria imutável, não pode ser forjada isoladamente; ADMIN cancela, não apaga produção',async()=>{
  const ctx=context('admin'); await create(ctx,'admin');
  const audit=sdk.doc(ref(ctx,'admin'),'auditoria','r1');
  await assertFails(sdk.updateDoc(audit,{motivoCorrecao:'apagar rastro'}));
  await assertFails(sdk.deleteDoc(audit)); await assertFails(sdk.deleteDoc(ref(ctx,'admin')));
  await assertFails(sdk.setDoc(sdk.doc(ref(ctx,'admin'),'auditoria','r2'),{revisao:2}));
});
test('edição concorrente: uma revisão vence e outra não sobrescreve',async()=>{
  const ctx=context('autor'); await create(ctx,'concorrente');
  const results=await Promise.allSettled([1,2].map(n=>store.salvarRegistro(ctx,{id:'concorrente',revisaoEsperada:1,entrada:entrada({qtdHoje:n+1}),motivo:'Ajuste '+n,operacaoId:'concorrencia-'+n})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await get(ctx,'concorrente')).revisao,2);
});
test('lançamentos concorrentes independentes não perdem produção',async()=>{
  const ctx=context('autor');
  await Promise.all([create(ctx,'simultaneo1',{qtdHoje:2}),create(ctx,'simultaneo2',{qtdHoje:3})]);
  assert.equal(calcular(cfg,[await get(ctx,'simultaneo1'),await get(ctx,'simultaneo2')]).micros.s1.executado,5);
});
test('configuração somente ADMIN; troca de modo, exclusão e progresso manual bloqueados',async()=>{
  const ctx=context('autor'), admin=context('admin');
  await assertFails(sdk.updateDoc(sdk.doc(ctx.db,'obras','obra','evolConfig','main'),{macros:[]}));
  await assertFails(sdk.setDoc(sdk.doc(ctx.db,'obras','obra','evolProgresso','u1_s1'),{qtdExec:99,pct:100}));
  await assertFails(sdk.updateDoc(sdk.doc(admin.db,'obras','obra','evolConfig','main'),{modoCalculo:'antigo'}));
  await assertFails(sdk.deleteDoc(sdk.doc(admin.db,'obras','obra','evolConfig','main')));
  const ctxNova={...admin,obraId:'nova'};
  await assertSucceeds(store.salvarConfig(ctxNova,{...cfg,revisaoConfig:0},0));
  await assert.rejects(store.salvarConfig({...admin,obraId:'legado'},cfg,0),/Conversão/);
  await assert.rejects(store.salvarConfig({...admin,obraId:'v2antigo'},cfg,0),/Conversão/);
});
test('V1/V2 antigo preservam gravação de progresso, lançamento e correção de foto; clima preservado',async()=>{
  const ctx=context('legado');
  for(const obra of ['legado','v2antigo']) {
    const p=sdk.doc(ctx.db,'obras',obra,'evolProgresso','u1_s1'), r=sdk.doc(ctx.db,'obras',obra,'evolRegistros','r');
    await assertSucceeds(sdk.setDoc(p,{unidId:'u1',svcId:'s1',qtdExec:1,pct:100}));
    await assertSucceeds(sdk.setDoc(r,{qtdHoje:1,criadoPor:'legado',fotoUrl:'antes',fotoUrlDepois:'depois'}));
    await assertSucceeds(sdk.updateDoc(r,{fotoUrl:'',atualizadoEm:sdk.serverTimestamp()}));
    await assertFails(sdk.updateDoc(r,{qtdHoje:2}));
  }
  const autor=context('autor');
  await assertSucceeds(sdk.setDoc(sdk.doc(autor.db,'obras','obra','evolHistorico','2026-09-01'),{data:'2026-09-01',clima:'chuva',diarioClimaPreenchido:true}));
});
