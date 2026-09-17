import test from 'node:test';
import assert from 'node:assert/strict';
import { parametrizada, validarConfig, calcular, historicoCalculado, prepararRegistro, podeProduzir, dataLocal } from '../evolucao-parametrizada.mjs';
import { config, entrada, registro, autorizado } from './fixture.mjs';
import { ativo, fecharPesos, retirarServico, modoApontamento, quantidadeApontada, validarLancamento } from '../evolucao-parametrizada.mjs';

test('config antiga considera Serviço ativo e modo quantidade',()=>{
  const cfg=config(); assert.equal(ativo(cfg.macros[0].micros[0]),true);
  assert.equal(modoApontamento(cfg),'quantidade'); assert.equal(quantidadeApontada(cfg,3,10),10);
  cfg.modoApontamento='percentual'; assert.equal(quantidadeApontada(cfg,3,10),0.3);
});
test('último Serviço fecha 100%, recalcula após edição e retirada',()=>{
  const m=config().macros[0]; fecharPesos(m); assert.equal(m.micros[0].pesoFisico,100);
  m.micros=[20,15,25,10,0].map((pesoFisico,i)=>({...m.micros[0],id:'x'+i,pesoFisico}));
  fecharPesos(m); assert.equal(m.micros[4].pesoFisico,30);
  m.micros[2].pesoFisico=35; fecharPesos(m); assert.equal(m.micros[4].pesoFisico,20);
  retirarServico(m,'x4','Retirada'); assert.equal(m.micros[3].pesoFisico,30);
});
test('retirada/substituição preserva IDs, registros e índice, sem medição vigente',()=>{
  const original=config(), cfg=config(), m=cfg.macros[0];
  const old=prepararRegistro(original,entrada(),null,{uid:'u',timestamp:'x'}).registro;
  const novo=retirarServico(m,'s1','Substituição de escopo','novo');
  assert.equal(novo.id,'novo'); assert.equal(m.micros[0].ativo,false);
  const index=validarConfig(cfg,original); assert.equal(index.s1.ativo,false); assert.equal(index.novo.ativo,true);
  assert.equal(calcular(cfg,[old]).global,0); assert.equal(calcular(cfg,[old]).locais.u1.aplicaveis,1);
  assert.equal(old.svcId,'s1'); assert.throws(()=>validarLancamento(cfg,entrada()),/retirado/);
  const edit=prepararRegistro(cfg,{...old,qtdHoje:2},old,{uid:'admin',timestamp:'x',motivo:'Correção',permitirInativo:true});
  assert.equal(edit.auditoria.dadosAnteriores.qtdHoje,1); assert.equal(edit.registro.qtdHoje,2);
  assert.throws(()=>prepararRegistro(cfg,entrada(),null,{uid:'admin',timestamp:'x',permitirInativo:true}),/retirado/);
});
test('soma excedente bloqueia; inativos não entram na distribuição ativa',()=>{
  const cfg=config(),m=cfg.macros[0]; m.micros.push({...m.micros[0],id:'s3',pesoFisico:0});
  m.micros[0].pesoFisico=101; fecharPesos(m); assert.equal(m.micros[1].pesoFisico,-1);
  assert.throws(()=>validarConfig(cfg));
  m.micros[0].ativo=false; m.micros[0].motivoRetirada='Mudança'; fecharPesos(m);
  assert.equal(m.micros[1].pesoFisico,100); assert.doesNotThrow(()=>validarConfig(cfg));
});

test('V1 e V2 antigo não ativam o novo cálculo', () => {
  assert.equal(parametrizada({ servicos: [] }), false);
  assert.equal(parametrizada({ modeloEvolucao: 2, macros: [{ micros: [{ peso: 5 }] }] }), false);
  assert.equal(parametrizada(config()), true);
});
test('configuração percentual e índice de referências válidos', () => {
  assert.deepEqual(validarConfig(config()).s1.metasPorLocal, { u1: 1, u2: 3, u3: 2 });
});
for (const soma of [99,101]) {
  test(`bloqueia soma das Macros em ${soma}%`, () => {
    const cfg=config(); cfg.macros[1].pesoFisico=soma-27;
    assert.throws(()=>validarConfig(cfg), /somar 100/);
  });
  test(`bloqueia soma das Micros em ${soma}%`, () => {
    const cfg=config(); cfg.macros[0].micros[0].pesoFisico=soma;
    assert.throws(()=>validarConfig(cfg), /100/);
  });
}
test('arredondamento decimal pequeno, sem aceitar 99.99%', () => {
  const cfg=config(), m=cfg.macros[0];
  m.micros=[33.33,33.33,33.34].map((pesoFisico,i)=>({...m.micros[0],id:'x'+i,pesoFisico}));
  assert.doesNotThrow(()=>validarConfig(cfg));
  m.micros[2].pesoFisico=33.33;
  assert.throws(()=>validarConfig(cfg));
});
for(const [nome,mutate] of [
  ['Macro sem Micro',cfg=>{cfg.macros[0].micros=[];}],
  ['unidade vazia',cfg=>{cfg.macros[0].micros[0].unidade='';}],
  ['meta zero',cfg=>{cfg.macros[0].micros[0].metasPorLocal.u1=0;}],
  ['meta negativa',cfg=>{cfg.macros[0].micros[0].metasPorLocal.u1=-1;}],
  ['IDs duplicados',cfg=>{cfg.macros[0].micros[0].id='s2';}],
  ['local inexistente',cfg=>{cfg.macros[0].micros[0].metasPorLocal.naoExiste=1;}],
  ['sem local aplicável',cfg=>{cfg.macros[0].micros[0].metasPorLocal={};}],
]) test(`valida ${nome}`,()=>{ const cfg=config(); mutate(cfg); assert.throws(()=>validarConfig(cfg)); });
test('preserva referências e bloqueia conversão automática',()=>{
  assert.throws(()=>validarConfig(config(),{modeloEvolucao:2,macros:[]}),/Conversão/);
  const cfg=config(); cfg.unidades.pop(); assert.throws(()=>validarConfig(cfg,config()),/locais já salvos/);
  const cfg2=config(); delete cfg2.macros[0].micros[0].metasPorLocal.u3;
  assert.throws(()=>validarConfig(cfg2,config()),/aplicações/);
});
test('metas 1/3/2: soma de quantidades, não média simples de locais',()=>{
  const result=calcular(config(),[registro(),registro({unidId:'u2'})]);
  assert.equal(result.micros.s1.previsto,6);
  assert.ok(Math.abs(result.micros.s1.pct-100/3)<1e-10);
  assert.ok(Math.abs(result.global-9)<1e-10);
  assert.equal(result.locais.u4.aplicaveis,0);
});
test('Macro 27% executada em 50% entrega 13.5 pontos percentuais',()=>{
  const result=calcular(config(),[registro({unidId:'u2',qtdHoje:3})]);
  assert.equal(result.macros.m1.pct,50); assert.equal(result.global,13.5);
});
test('vários dias, obra completa e excedente sem perda do executado',()=>{
  const regs=[registro(),registro({unidId:'u2',qtdHoje:3,data:'2026-09-02'}),registro({unidId:'u3',qtdHoje:2,data:'2026-09-03'}),registro({unidId:'u2',svcId:'s2',qtdHoje:12,data:'2026-09-03'})];
  const result=calcular(config(),regs);
  assert.equal(result.global,100); assert.equal(result.macros.m1.pct,100);
  assert.equal(result.micros.s2.executado,12); assert.equal(result.progresso.u2_s2.saldo,-2);
  assert.equal(historicoCalculado(config(),regs).length,3);
});
test('percentual da Micro usa todo excedente válido, sem corte antecipado por local',()=>{
  const result=calcular(config(),[registro({qtdHoje:6})]);
  assert.equal(result.micros.s1.executado,6); assert.equal(result.macros.m1.pct,100);
  assert.equal(result.locais.u2.concluidos,0);
});
test('Micros contribuem segundo pesos físicos distintos',()=>{
  const cfg=config(), m=cfg.macros[0];
  m.micros[0].pesoFisico=40;
  m.micros.push({id:'s3',desc:'Outro',pesoFisico:60,unidade:'un',metasPorLocal:{u1:1}});
  assert.equal(calcular(cfg,[registro({qtdHoje:6})]).macros.m1.pct,40);
});
test('correção de quantidade, troca de local/Micro e cancelamento recalculam tudo',()=>{
  const cfg=config(), timestamp='TEST';
  const created=prepararRegistro(cfg,entrada(),null,{uid:'autor',timestamp});
  const edited=prepararRegistro(cfg,entrada({qtdHoje:3,unidId:'u2'}),created.registro,{uid:'resp',timestamp,motivo:'Local errado'});
  assert.equal(edited.registro.criadoPor,'autor'); assert.equal(edited.registro.revisao,2);
  assert.equal(edited.auditoria.dadosAnteriores.qtdHoje,1); assert.equal(calcular(cfg,[edited.registro]).global,13.5);
  const moved=prepararRegistro(cfg,entrada({unidId:'u2',svcId:'s2',qtdHoje:10}),edited.registro,{uid:'resp',timestamp,motivo:'Serviço errado'});
  const r=calcular(cfg,[moved.registro]); assert.equal(r.micros.s1.executado,0); assert.equal(r.global,73);
  const canceled=prepararRegistro(cfg,moved.registro,moved.registro,{uid:'resp',timestamp,motivo:'Duplicado',cancelar:true});
  assert.equal(canceled.registro.qtdHoje,10); assert.equal(canceled.registro.canceladoPor,'resp');
  assert.equal(calcular(cfg,[canceled.registro]).global,0);
  assert.throws(()=>prepararRegistro(cfg,moved.registro,canceled.registro,{uid:'x',timestamp,motivo:'x'}),/cancelado/);
});
test('foto Antes/Depois independentes; correção exige motivo e preserva produção',()=>{
  const cfg=config(), timestamp='TEST';
  const r=prepararRegistro(cfg,entrada({fotoUrl:'a',fotoUrlDepois:'b'}),null,{uid:'u',timestamp}).registro;
  const corrected=prepararRegistro(cfg,{...r,fotoUrl:''},r,{uid:'u',timestamp,motivo:'Foto errada'});
  assert.equal(corrected.registro.fotoUrlDepois,'b'); assert.equal(corrected.registro.qtdHoje,1);
  assert.equal(corrected.registro.tipoFoto,'depois'); assert.equal(corrected.auditoria.dadosAnteriores.fotoUrl,'a');
  assert.throws(()=>prepararRegistro(cfg,r,r,{uid:'u',timestamp}),/motivo/);
});
test('permissões por papel, atividade e vínculo; visitante não escreve mesmo com flags',()=>{
  assert.equal(podeProduzir(autorizado,'obra'),true);
  assert.equal(podeProduzir({...autorizado,role:'VISITANTE'},'obra'),false);
  assert.equal(podeProduzir({...autorizado,ativo:false},'obra'),false);
  assert.equal(podeProduzir(autorizado,'outra'),false);
  assert.equal(podeProduzir({...autorizado,permEvolucao:false},'obra'),false);
  assert.equal(podeProduzir({role:'ADMIN'},'qualquer'),true);
});
test('data diária local e produção inválida não mascarada como zero',()=>{
  assert.equal(dataLocal(new Date(2026,8,16,23,55)), '2026-09-16');
  assert.throws(()=>calcular(config(),[registro({svcId:'inexistente'})]),/incompatível/);
  for(const qty of [-1,Infinity,NaN]) assert.throws(()=>prepararRegistro(config(),entrada({qtdHoje:qty}),null,{uid:'u',timestamp:'x'}));
});
