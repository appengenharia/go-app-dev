import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { criarInterface } from '../evolucao-parametrizada-ui.mjs';
import { calcular } from '../evolucao-parametrizada.mjs';
import { config, autorizado, registro } from './fixture.mjs';

function setup(profile=autorizado, cfg=config(), registros=[]) {
  const dom=new JSDOM('<!doctype html><body><div id="summary"></div></body>',{url:'http://127.0.0.1/'});
  globalThis.document=dom.window.document;
  let i=0, offline=false, state=cfg?calcular(cfg,registros):null, refreshed=0;
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
  t.input('[data-reason]','Ajuste de planejamento');
  t.el('[data-action="save"]').click(); await t.settle();
  assert.equal(t.refreshed,1);
});

test('editor recolhível preserva campos e estado; erro abre Serviço e Etapa corretos',async()=>{
  const t=setup({role:'ADMIN'}); t.ui.openConfig();
  assert.match(t.el('[data-body]').textContent,/Etapas — distribuição/);
  assert.doesNotMatch(t.el('[data-body]').textContent,/\bMacros?\b|\bMicros?\b/);
  t.input('[data-macro="m1"] [data-macro-field="nome"]','Civil editada');
  t.el('[data-key="m1"]').open=false;
  t.change('[data-config="grupos"]','Setor A\nNovo');
  assert.equal(t.el('[data-key="m1"]').open,false);
  assert.equal(t.el('[data-macro="m1"] [data-macro-field="nome"]').value,'Civil editada');
  t.input('[data-micro="s1"] [data-meta="u1"]','0');
  t.el('[data-action="collapse"]').click();
  t.el('[data-action="save"]').click(); await t.settle();
  assert.equal(t.el('[data-key="m1"]').open,true);
  assert.equal(t.el('[data-key="s1"]').open,true);
  assert.match(t.el('[data-micro="s1"] [data-local-error]').textContent,/maior que zero/);
  assert.equal(document.activeElement,t.el('[data-micro="s1"] [data-meta="u1"]'));
});

test('último peso automático recalcula e bloqueia distribuição acima de 100',async()=>{
  const cfg=config(); cfg.macros[0].micros.push({...cfg.macros[0].micros[0],id:'s3',pesoFisico:30}); cfg.macros[0].micros[0].pesoFisico=70;
  const t=setup({role:'ADMIN'},cfg); t.ui.openConfig();
  assert.equal(t.el('[data-micro="s3"] [data-micro-field="pesoFisico"]').readOnly,true);
  t.input('[data-micro="s1"] [data-micro-field="pesoFisico"]','65');
  assert.equal(t.el('[data-micro="s3"] [data-micro-field="pesoFisico"]').value,'35');
  t.input('[data-micro="s1"] [data-micro-field="pesoFisico"]','101');
  assert.match(t.el('[data-stage-total]').textContent,/maior que 0/);
  t.el('[data-action="save"]').click(); await t.settle();
  assert.equal(t.refreshed,0); assert.ok(t.el('[data-error]').textContent);
});

test('percentual diário converte meta 3 + 10% em 0.3; correção mantém auditoria',async()=>{
  const cfg=config(); cfg.modoApontamento='percentual'; const t=setup({role:'ADMIN'},cfg);
  t.ui.openRecord({unidId:'u2',svcId:'s1'}); t.input('[data-quantity]','10');
  assert.match(t.el('[data-preview]').textContent,/10%/);
  t.el('[data-save]').click(); await t.settle();
  const [path,r]=[...t.docs].find(([p])=>/^obras\/obra\/evolRegistros\/[^/]+$/.test(p));
  assert.equal(r.qtdHoje,0.3);
  t.ui.openRecord({},'e',{...r,id:path.split('/').at(-1)});
  assert.equal(Number(t.el('[data-quantity]').value),10);
  t.input('[data-quantity]','20'); t.input('[data-reason]','Correção do avanço');
  t.el('[data-save]').click(); await t.settle();
  assert.equal(t.docs.get(path).qtdHoje,0.6);
  assert.equal(t.docs.get(path+'/auditoria/r2').dadosAnteriores.qtdHoje,0.3);
});

for(const profile of [{role:'ADMIN'},autorizado]) test(`resumo de Etapas preservado na Evolução para ${profile.role}`,()=>{
  const t=setup(profile,config(),[registro({qtdHoje:3})]);
  t.ui.renderSummary(t.el('#summary'),'e');
  assert.match(t.el('#summary').textContent,/50% executado/);
  assert.match(t.el('#summary').textContent,/13,5 p.p./);
});

test('Visitante vê o mesmo motor parametrizado sem controles operacionais',()=>{
  const cfg=config(), regs=[registro({qtdHoje:3})], t=setup({...autorizado,role:'VISITANTE'},cfg,regs);
  assert.equal(calcular(cfg,regs).global,13.5);
  t.ui.renderSummary(t.el('#summary'),'v');
  assert.match(t.el('#summary').textContent,/50% executado/);
  assert.match(t.el('#summary').textContent,/13,5 p.p./);
  t.ui.openUnit('u2','v');
  assert.equal(t.el('[data-register]'),null); assert.equal(t.el('[data-save]'),null);
  assert.throws(()=>t.ui.openConfig(),/ADMIN/);
});

test('substituição na UI preserva Serviço salvo, exige confirmação e audita planejamento',async()=>{
  const t=setup({role:'ADMIN'}); t.ui.openConfig();
  const oldPrompt=globalThis.prompt,oldConfirm=globalThis.confirm;
  try {
    globalThis.prompt=()=> 'Nova solução técnica'; globalThis.confirm=()=>false;
    t.el('[data-action="replace"][data-id="s1"]').click();
    assert.ok(t.el('[data-micro="s1"]'));
    globalThis.confirm=()=>true;
    t.el('[data-action="replace"][data-id="s1"]').click();
    assert.equal(t.el('[data-micro="s1"]'),null);
    assert.match(t.el('[data-key="retirados-m1"]').textContent,/Bacia de contenção/);
    t.input('[data-reason]','Substituição aprovada');
    t.el('[data-action="save"]').click(); await t.settle();
    const next=t.docs.get('obras/obra/evolConfig/main');
    assert.equal(next.macros[0].micros[0].id,'s1'); assert.equal(next.macros[0].micros[0].ativo,false);
    assert.notEqual(next.macros[0].micros[1].id,'s1'); assert.equal(next.macros[0].micros[1].substituiServicoId,'s1');
    assert.equal(t.docs.get('obras/obra/evolConfig/main/auditoria/r2').dadosAnteriores.macros[0].micros.length,1);
  } finally { globalThis.prompt=oldPrompt; globalThis.confirm=oldConfirm; }
});

test('Serviço retirado some de novos lançamentos; somente ADMIN edita seu histórico',async()=>{
  const cfg=config(); const s=cfg.macros[0].micros[0]; s.ativo=false;s.motivoRetirada='Escopo';
  cfg.macros[0].micros.push({...s,id:'novo',ativo:true});
  const t=setup(autorizado,cfg); t.ui.openRecord({unidId:'u1',svcId:'s1'});
  assert.equal(t.el('[data-micro] option[value="s1"]'),null); assert.equal(t.el('[data-micro]').value,'novo');
  t.ui.openRecord({},'e',{id:'r',svcId:'s1',unidId:'u1',qtdHoje:1});
  assert.match(t.el('[data-error]').textContent,/ADMIN/); assert.equal(t.el('[data-save]'),null);
  const admin=setup({role:'ADMIN'},cfg); admin.ui.openRecord({},'e',{id:'r',svcId:'s1',unidId:'u1',qtdHoje:1});
  assert.equal(admin.el('[data-micro]').value,'s1'); assert.ok(admin.el('[data-save]'));
  assert.match(admin.el('[data-body]').textContent,/Serviço retirado do escopo — histórico preservado/);
  assert.equal(admin.el('[data-micro]').disabled,true); assert.equal(admin.el('[data-macro]').disabled,true);
  assert.equal(admin.el('[data-micro]').options.length,1); assert.equal(admin.el('[data-macro]').options.length,1);
  assert.equal(admin.el('[data-local] option[value="u4"]'),null);
  admin.change('[data-local]','u2');
  assert.equal(admin.el('[data-micro]').value,'s1'); assert.equal(admin.el('[data-macro]').value,'m1');
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
