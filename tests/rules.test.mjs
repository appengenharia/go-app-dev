import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import * as sdk from 'firebase/firestore';
import { criarStore } from '../evolucao-parametrizada-store.mjs';
import { calcular, prepararRegistro, retirarServico } from '../evolucao-parametrizada.mjs';
import { config, entrada, autorizado } from './fixture.mjs';

// Proteção contra execução acidental em qualquer projeto real.
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8089') throw new Error('Execute somente pelo emulador local em 127.0.0.1:8089.');
const projectId = 'demo-go-evolucao';
let env;
const cfg = config(), store = criarStore(sdk);
// Simula um planejamento V2 já salvo antes da inclusão de ativo no índice.
Object.values(cfg.itensPorId).forEach(item=>{delete item.ativo;});
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

test('acessos: próprio login válido, somente ADMIN lê; append-only para todos',async()=>{
  const visitante=context('visitante'),admin=context('admin');
  const target=sdk.doc(visitante.db,'acessos','login-valido');
  const value={uid:'visitante',role:'VISITANTE',obraId:'',evento:'login',criadoEm:sdk.serverTimestamp()};
  await assertSucceeds(sdk.setDoc(target,value));
  await assertFails(sdk.getDoc(target));
  await assertFails(sdk.getDocs(sdk.collection(visitante.db,'acessos')));
  await assertSucceeds(sdk.getDoc(sdk.doc(admin.db,'acessos','login-valido')));
  for(const ctx of [visitante,admin]) {
    await assertFails(sdk.updateDoc(sdk.doc(ctx.db,'acessos','login-valido'),{evento:'outro'}));
    await assertFails(sdk.deleteDoc(sdk.doc(ctx.db,'acessos','login-valido')));
  }
  for(const [i,patch] of [{uid:'admin'},{role:'ADMIN'},{criadoEm:sdk.Timestamp.fromMillis(1)},{obraId:'outra'},{evento:'logout'},{token:'nao'}].entries()) {
    await assertFails(sdk.setDoc(sdk.doc(visitante.db,'acessos','forjado-'+i),{...value,...patch}));
  }
  await assertFails(sdk.setDoc(sdk.doc(env.unauthenticatedContext().firestore(),'acessos','anonimo'),value));
  await assertSucceeds(sdk.setDoc(sdk.doc(admin.db,'acessos','login-admin'),{...value,uid:'admin',role:'ADMIN'}));
  await assertSucceeds(sdk.setDoc(sdk.doc(context('autor').db,'acessos','login-user'),{...value,uid:'autor',role:'USER'}));
});

test('auditoria de planejamento atômica, motivo obrigatório e revisões imutáveis',async()=>{
  const ctx={...context('admin'),obraId:'audit-plan'};
  const initial=await store.salvarConfig(ctx,{...cfg,revisaoConfig:0},0);
  const plan=sdk.doc(ctx.db,'obras',ctx.obraId,'evolConfig','main');
  const audit=sdk.doc(plan,'auditoria','r1');
  assert.equal((await sdk.getDoc(audit)).data().motivo,'Configuração inicial');
  await assert.rejects(store.salvarConfig(ctx,initial,1),/motivo/);
  await assertFails(sdk.updateDoc(plan,{revisaoConfig:2,tipoUnidade:'Tentativa sem auditoria'}));
  const updated=await store.salvarConfig(ctx,{...initial,tipoUnidade:'Trecho'},1,'Novo tipo de local');
  assert.equal(updated.revisaoConfig,2);
  const revision=(await sdk.getDoc(sdk.doc(plan,'auditoria','r2'))).data();
  assert.equal(revision.dadosAnteriores.tipoUnidade,'Tracker'); assert.equal(revision.dadosNovos.tipoUnidade,'Trecho');
  await assertFails(sdk.updateDoc(audit,{motivo:'reescrever'})); await assertFails(sdk.deleteDoc(audit));
  await assertFails(sdk.setDoc(sdk.doc(plan,'auditoria','r3'),{...revision,revisao:3}));
  const user={...context('autor'),obraId:'audit-plan'};
  await assertFails(sdk.getDoc(sdk.doc(user.db,'obras',user.obraId,'evolConfig','main','auditoria','r1')));
});

test('Serviço retirado: sem produção nova; ADMIN corrige/cancela histórico com auditoria',async()=>{
  const ctx={...context('admin'),obraId:'retirada'};
  ctx.cfg=await store.salvarConfig(ctx,{...config(),revisaoConfig:0},0);
  const recordRef=sdk.doc(ctx.db,'obras','retirada','evolRegistros','antigo');
  await store.salvarRegistro(ctx,{id:'antigo',entrada:entrada({fotoUrl:'antes',fotoUrlDepois:'depois'}),operacaoId:'retirada-create'});
  const updated=structuredClone(config()); retirarServico(updated.macros[0],'s1','Escopo substituído','novo');
  ctx.cfg=await store.salvarConfig(ctx,updated,1,'Substituição de escopo');
  let old=(await sdk.getDoc(recordRef)).data();
  assert.equal(calcular(ctx.cfg,[old]).global,0);
  await assert.rejects(store.salvarRegistro(ctx,{id:'proibido',entrada:entrada(),operacaoId:'proibido'}),/retirado/);
  // SDK direto: nem ADMIN pode criar uma produção em serviço retirado.
  const forged=prepararRegistro(cfg,entrada(),null,{uid:'admin',timestamp:sdk.serverTimestamp()});
  forged.registro.revisaoConfig=ctx.cfg.revisaoConfig; forged.auditoria.dadosNovos=forged.registro;
  const batch=sdk.writeBatch(ctx.db),invalid=sdk.doc(ctx.db,'obras','retirada','evolRegistros','direto');
  batch.set(invalid,forged.registro); batch.set(sdk.doc(invalid,'auditoria','r1'),{...forged.auditoria,operacaoId:'direto'});
  await assertFails(batch.commit());
  await env.withSecurityRulesDisabled(async c=>{await sdk.setDoc(sdk.doc(c.firestore(),'usuarios','campo-retirada'),{...autorizado,obras:['retirada']});});
  const user={...ctx,db:env.authenticatedContext('campo-retirada').firestore(),user:{uid:'campo-retirada'}};
  await assert.rejects(store.salvarRegistro(user,{id:'novo-proibido',entrada:entrada(),operacaoId:'user-create'}),/retirado/);
  await assert.rejects(store.salvarRegistro(user,{id:'antigo',entrada:old,revisaoEsperada:1,motivo:'Teste',operacaoId:'user-edit'}),/ADMIN/);
  const editPair=prepararRegistro(ctx.cfg,{...old,qtdHoje:2},old,{uid:'campo-retirada',timestamp:sdk.serverTimestamp(),motivo:'Tentativa direta',permitirInativo:true});
  const editBatch=sdk.writeBatch(user.db),userRef=sdk.doc(user.db,'obras','retirada','evolRegistros','antigo');
  editBatch.set(userRef,editPair.registro); editBatch.set(sdk.doc(userRef,'auditoria','r2'),{...editPair.auditoria,operacaoId:'direto-edit'});
  await assertFails(editBatch.commit());
  await assertSucceeds(store.salvarRegistro(ctx,{id:'antigo',entrada:{...old,qtdHoje:2},revisaoEsperada:1,motivo:'Correção histórica',operacaoId:'admin-edit'}));
  old=(await sdk.getDoc(recordRef)).data(); assert.equal(old.fotoUrlDepois,'depois');
  await assertSucceeds(store.salvarRegistro(ctx,{id:'antigo',entrada:old,revisaoEsperada:2,motivo:'Duplicado',cancelar:true,operacaoId:'admin-cancel'}));
  assert.equal((await store.carregarAuditoria(ctx.db,'retirada','antigo')).length,3);
  assert.equal((await store.carregarRegistros(ctx.db,'retirada')).length,1);
  await assertSucceeds(store.salvarRegistro(user,{id:'novo-ativo',entrada:entrada({svcId:'novo'}),operacaoId:'user-active'}));
});

test('Visitante não escreve DDS, mensagens, ponto ou despesas, inclusive próprios documentos',async()=>{
  const visitor=context('visitante'),user=context('autor');
  for(const path of ['obras/obra/dds/vis','obras/obra/mensagens/vis','pontos/vis','lancamentos/vis']) {
    const r=sdk.doc(visitor.db,path);
    const data={uid:'visitante',colaborador_uid:'visitante',texto:'Teste'};
    await assertFails(sdk.setDoc(r,data));
    await env.withSecurityRulesDisabled(async c=>sdk.setDoc(sdk.doc(c.firestore(),path),data));
    await assertFails(sdk.updateDoc(r,{texto:'Mudança'})); await assertFails(sdk.deleteDoc(r));
    await assertSucceeds(sdk.getDoc(r));
    await assertSucceeds(sdk.setDoc(sdk.doc(user.db,path+'-user'),{uid:'autor',colaborador_uid:'autor',texto:'Permitido'}));
  }
});

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
