import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { criarInterface } from '../evolucao-parametrizada-ui.mjs';
import { calcular } from '../evolucao-parametrizada.mjs';
import { config, autorizado } from './fixture.mjs';

function setup(profile=autorizado, cfg=config()) {
  const dom=new JSDOM('<!doctype html><body><div id="summary"></div></body>',{url:'http://127.0.0.1/'});
  globalThis.document=dom.window.document;
  let i=0, offline=false, state=cfg?calcular(cfg,[]):null, refreshed=0;
  const db={}, docs=new Map([['usuarios/autor',profile],['obras/obra/evolConfig/main',cfg]]);
  const snapshot=(path)=>({exists:()=>docs.get(path)!=null,data:()=>docs.get(path)});
  const sdk={
    collection:(base,...parts)=>({path:[base.path,...parts].filter(Boolean).join('/')}),
    doc:(base,...parts)=>({path:[base.path,...(parts.length?parts:['id'+(++i)])].filter(Boolean).join('/'),id:parts.at(-1)||'id'+i}),
    serverTimestamp:()=>({seconds:123}),
    getDocsFromServer:async ref=>{
      if(offline) throw new Error('Sem rede');
      return {docs:[...docs].filter(([k])=>k.startsWith(ref.path+'/')&&k.split('/').length===ref.path.split('/').length+1).map(([k,v])=>({id:k.split('/').at(-1),data:()=>v}))};
    },
    runTransaction:async (_,fn)=>{
      if(offline) throw new Error('Sem rede');
      const writes=[];
      await fn({get:async ref=>snapshot(ref.path),set:(ref,value)=>writes.push([ref.path,value])});
      writes.forEach(([path,value])=>docs.set(path,value));
    },
  };
  const context={db,obraId:'obra',cfg,user:{uid:'autor'},profile};
  const ui=criarInterface({sdk,getContext:()=>context,getState:()=>state,refresh:async()=>{
    refreshed++; context.cfg=docs.get('obras/obra/evolConfig/main');
    state=calcular(context.cfg,await ui.carregarRegistros(db,'obra'));
  },uploadPhoto:async()=>{if(offline)throw new Error('Falha no upload');return 'https://example.test/foto';}});
  const el=s=>document.querySelector(s);
  const input=(selector,value)=>{const e=el(selector); e.value=value; e.dispatchEvent(new dom.window.Event('input',{bubbles:true}));};
  const change=(selector,value)=>{const e=el(selector); e.value=value; e.dispatchEvent(new dom.window.Event('change',{bubbles:true}));};
  const settle=async()=>{for(let n=0;n<20;n++)await new Promise(r=>setImmediate(r));};
  return {ui,el,input,change,settle,docs,dom,context,get refreshed(){return refreshed;},setOffline:v=>{offline=v;}};
}
test('formulário só oferece Micros aplicáveis; grava quantidade sem percentual manual',async()=>{
  const t=setup(); t.ui.openRecord({unidId:'u1',svcId:'s1'});
  assert.equal(t.el('[data-micro]').options.length,1);
  assert.equal(t.el('[data-macro]').options.length,1);
  t.change('[data-local]','u2'); assert.equal(t.el('[data-macro]').options.length,2);
  t.change('[data-macro]','m2'); assert.equal(t.el('[data-micro]').value,'s2');
  t.input('[data-quantity]','12'); t.input('[data-obs]','Excedente preservado');
  t.el('[data-save]').click(); await t.settle();
  const regs=[...t.docs].filter(([p])=>/^obras\/obra\/evolRegistros\/[^/]+$/.test(p));
  assert.equal(regs.length,1); assert.equal(regs[0][1].qtdHoje,12); assert.equal(regs[0][1].macroId,'m2');
  assert.equal(t.refreshed,1); assert.equal(document.querySelectorAll('[data-quantity]').length,0);
});
test('erros de rede mantêm formulário e não apresentam gravação parcial',async()=>{
  const t=setup(); t.ui.openRecord({unidId:'u1',svcId:'s1'}); t.input('[data-quantity]','1');
  t.setOffline(true); t.el('[data-save]').click(); await t.settle();
  assert.match(t.el('[data-error]').textContent,/Sem rede/);
  assert.equal(t.el('[data-quantity]').value,'1'); assert.equal(t.el('[data-save]').disabled,false);
  assert.equal([...t.docs.keys()].filter(p=>p.includes('evolRegistros')).length,0);
  t.setOffline(false); t.el('[data-save]').click(); await t.settle(); assert.equal(t.refreshed,1);
});
test('Visitante vê metas e histórico, sem controles de escrita',()=>{
  const t=setup({...autorizado,role:'VISITANTE'}); t.ui.openUnit('u1','v');
  assert.match(t.el('[data-body]').textContent,/previsto 1/);
  assert.equal(t.el('[data-register]'),null);
  t.ui.openRecord({unidId:'u1',svcId:'s1'},'v');
  assert.match(t.el('[data-error]').textContent,/permissão/); assert.equal(t.el('[data-save]'),null);
});
test('editor ADMIN aceita tipo genérico, locais, Macros, Micros e metas',async()=>{
  const t=setup({role:'ADMIN'},null); t.ui.openConfig();
  t.input('[data-config="tipoUnidade"]','Pavimento');
  t.el('[data-action="add-local"]').click(); t.input('[data-local-field="nome"]','Térreo');
  t.el('[data-action="add-macro"]').click(); t.input('[data-macro-field="nome"]','Estrutura');
  t.el('[data-action="add-micro"]').click(); t.input('[data-micro-field="desc"]','Concreto');
  t.input('[data-micro-field="unidade"]','m³'); t.input('[data-meta]','25');
  t.el('[data-action="save"]').click(); await t.settle();
  const cfg=t.docs.get('obras/obra/evolConfig/main');
  assert.equal(cfg.tipoUnidade,'Pavimento'); assert.equal(cfg.macros[0].pesoFisico,100);
  assert.equal(cfg.macros[0].micros[0].pesoFisico,100); assert.equal(cfg.revisaoConfig,1);
});
test('configuração incompleta fica aberta com erro claro',async()=>{
  const t=setup({role:'ADMIN'}); t.ui.openConfig();
  t.input('[data-macro-field="pesoFisico"]','26');
  t.el('[data-action="save"]').click(); await t.settle();
  assert.match(t.el('[data-error]').textContent,/somar 100/); assert.equal(t.refreshed,0);
  assert.equal(t.el('[data-total-macros]').textContent,'99');
  t.input('[data-macro-field="pesoFisico"]','25');
  assert.equal(t.el('[data-error]').textContent,'');
  assert.equal(t.el('[data-total-macros]').textContent,'98');
  t.el('[data-action="save"]').click(); await t.settle();
  assert.match(t.el('[data-error]').textContent,/somar 100/);
  t.change('[data-local-field="grupo"]','');
  assert.equal(t.el('[data-error]').textContent,'');
  t.input('[data-macro-field="pesoFisico"]','27');
  assert.equal(t.el('[data-total-macros]').textContent,'100');
  t.el('[data-action="save"]').click(); await t.settle();
  assert.equal(t.refreshed,1);
});
test('edição exige motivo, preserva foto Depois ao remover Antes, histórico sem fotos acessível',async()=>{
  const t=setup();
  await t.ui.salvarRegistro(t.context,{id:'r',entrada:{unidId:'u1',svcId:'s1',qtdHoje:1,obs:'',fotoUrl:'a',fotoUrlDepois:'b'},operacaoId:'create'});
  const r={...t.docs.get('obras/obra/evolRegistros/r'),id:'r'};
  t.ui.openRecord({},'e',r); t.el('[data-remove-photo="fotoUrl"]').click();
  assert.equal(t.el('[data-photo-preview="fotoUrlDepois"]').getAttribute('src'),'b');
  t.el('[data-save]').click(); await t.settle(); assert.match(t.el('[data-error]').textContent,/motivo/);
  t.input('[data-reason]','Foto incorreta'); t.el('[data-save]').click(); await t.settle();
  const saved=t.docs.get('obras/obra/evolRegistros/r'); assert.equal(saved.fotoUrl,''); assert.equal(saved.qtdHoje,1);
  await t.ui.openHistory(); assert.equal(t.el('[data-edit]').dataset.edit,'r'); assert.ok(t.el('[data-audit]'));
});
