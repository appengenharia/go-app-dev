import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { spawnSync, execFileSync } from 'node:child_process';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const baseline=execFileSync('git',['show','bb6661f64ee374b6c1ede4b34ad4096e83c6e88d:index.html'],{encoding:'utf8',maxBuffer:5e6}).replace(/\r\n/g,'\n');
const source=html.replace(/\r\n/g,'\n');
function block(text,start,end){ return text.slice(text.indexOf(start),text.indexOf(end,text.indexOf(start))); }
test('JavaScript principal continua sintaticamente válido',()=>{
  const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  const result=spawnSync(process.execPath,['--check','--input-type=module'],{input:script,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});
test('corpo de salvamento V1/V2 legado e editor V2 preservados',()=>{
  for(const [start,end] of [
    ['    const uid=$("evolRegUnidId").value;', '  // ──────────────────────────── GALERIA DE FOTOS'],
    ['  function _eGarantirDraftV2(){','    async function evolCfgSalvarV2(){'],
    ['    // ─────────────────────────────────────────────\n    // SEGURANÇA — configuração estrutural','  async function evolAnalisarIA()'],
  ]) assert.equal(block(source,start,end),block(baseline,start,end));
});
test('V1 IBITU e V2 relativo mantêm cálculos de Macro, Unidade e Global',()=>{
  const calc=block(source,'  const _ePctSvc','  // ──────────────────────────── RENDERIZAR PAINEL');
  const oldCalc=block(baseline,'  const _ePctSvc','  // ──────────────────────────── RENDERIZAR PAINEL');
  const run=(code,cfg)=>vm.runInNewContext(code+'\n[_ePctUnid("u1"),_ePctUnid("u2"),_ePctGlobal()]',{
    _epModo:()=>false,_eCfg:cfg,_eProg:{u1_s1:{pct:50,qtdExec:1},u1_s2:{pct:100,qtdExec:1},u2_s1:{pct:100,qtdExec:2}},
  });
  for(const cfg of [
    {unidades:[{id:'u1'},{id:'u2'}],servicos:[{id:'s1',peso:3},{id:'s2',peso:1}]},
    {modeloEvolucao:2,unidades:[{id:'u1'},{id:'u2'}],macros:[{id:'m1',percentual:100,micros:[{id:'s1',peso:3},{id:'s2',peso:1}]}]},
  ]) assert.deepEqual([...run(calc,cfg)],[...run(oldCalc,cfg)]);
});
test('API App antiga preservada e galeria continua sem deleteDoc',()=>{
  const api=block(source,'  window.App = {','</script>');
  for(const name of ['evolCfgSalvar','evolAbrirReg','evolFotoSel','evolFotoRemover','evolSalvarReg','evolAbrirGaleria','vApagarFoto','vTrocarFoto']) assert.ok(api.includes(name));
  for(const [start,end] of [['async function _evolApagarFotoAdm','  function evolVerFotoAmp'],['async function vApagarFoto','  async function']]) {
    const content=block(source,start,end);
    assert.ok(content.includes('updateDoc')); assert.ok(!content.includes('deleteDoc('));
  }
});
