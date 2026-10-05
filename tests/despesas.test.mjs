import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import * as despesas from '../despesas.mjs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const bloco = (inicio, fim) => html.slice(html.indexOf(inicio), html.indexOf(fim, html.indexOf(inicio)));
const registros = [
  {id:'r', obra_id:'a', data:'2026-10-01', colaborador_uid:'u', valor:10, reembolsavel:true, pago:true},
  {id:'e', obra_id:'a', data:'2026-10-31', colaborador_uid:'u', valor:20, reembolsavel:false},
  {id:'antigo', obra_id:'a', data:'2026-10-15', colaborador_uid:'u', valor:30},
  {id:'outro-colab', obra_id:'a', data:'2026-10-10', colaborador_uid:'v', valor:40, reembolsavel:true},
  {id:'outra-obra', obra_id:'b', data:'2026-10-15', colaborador_uid:'u', valor:80, reembolsavel:true},
  {id:'outro-mes', obra_id:'a', data:'2026-09-30', colaborador_uid:'u', valor:160, reembolsavel:true},
  {id:'sem-data', obra_id:'a', colaborador_uid:'u', valor:320},
].map(l=>({...l, descricao:l.id, colaborador_nome:l.colaborador_uid, categoria:'Outros gastos', comprovante:{url:`https://example.test/${l.id}.jpg`}}));

function ambiente(role='ADMIN', profile={obras:['a','b']}) {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const $ = id=>document.getElementById(id);
  for (const id of ['relObra','filterLancObra']) $(id).innerHTML='<option value="">Todas</option><option value="a">Obra A</option><option value="b">Obra B</option>';
  $('relColab').innerHTML='<option value="">Todos</option><option value="u">U</option><option value="v">V</option>';
  $('relObra').value='a'; $('filterLancObra').value='a';
  $('relDe').value='2026-10-01'; $('relAte').value='2026-10-31'; $('filterLancMes').value='2026-10';
  const pdfs=[], envios=[], writes=[];
  class PDF {
    constructor(){this.textos=[]; this.tables=[]; this.internal={getNumberOfPages:()=>1}; pdfs.push(this);}
    text(t){this.textos.push(t);}
    autoTable(t){this.tables.push(t);this.lastAutoTable={finalY:100};}
    output(){return 'data:application/pdf;base64,TESTE';}
    save(n){this.filename=n;}
    setFillColor(){} rect(){} setTextColor(){} setFontSize(){} setFont(){} addPage(){} setPage(){}
  }
  dom.window.HTMLFormElement.prototype.submit=function(){envios.push(JSON.parse(this.querySelector('input').value));};
  const context=vm.createContext({
    ...despesas, $, document, window:{jspdf:{jsPDF:PDF}}, console,
    currentRole:role, currentUser:{uid:'u'}, loadProfile:async()=>profile,
    canAcessarRelatorios:()=>true, canFazerLancamentos:()=>true,
    db:{}, collection:(_,name)=>name,
    getDocs:async()=>({docs:registros.map(l=>({id:l.id,data:()=>({...l})}))}),
    getDoc:async()=>({exists:()=>true,data:()=>({destinatarios:['teste@example.test']})}),
    doc:()=>({}), setDoc:async(_,data)=>writes.push(data), serverTimestamp:()=>null,
    setMsg:(id,msg)=>$(id).textContent=msg, toast:()=>{},
    setTimeout:fn=>fn(), CATEGORIAS_CORES:{'Outros gastos':'#000'}, APPS_SCRIPT_URL:'https://example.test/send',
  });
  vm.runInContext(bloco('  let allLancs = [];','  async function updateStatTotal()') +
    bloco('  async function getDadosRelatorio()', '  async function verificarFechamentoMensal()'),context);
  return {context,$,pdfs,envios,writes,dom};
}

test('padrão Todas e classificação legada sem modificar registros nem pagamento',()=>{
  const orig=structuredClone(registros);
  assert.equal(despesas.tipoDespesa(registros[2]),'empresa');
  assert.equal(despesas.filtrarDespesas(registros).length,registros.length);
  assert.ok(despesas.filtrarDespesas(registros,{tipo:'reembolsaveis'}).some(l=>l.pago));
  assert.deepEqual(registros,orig);
  const a=ambiente();
  assert.equal(a.$('relTipo').value,'todas'); assert.equal(a.$('filterLancTipo').value,'todas');
  a.dom.window.close();
});

for(const [tipo, ids, total] of [
  ['todas',['r','outro-colab','antigo','e'],100],
  ['reembolsaveis',['r','outro-colab'],50],
  ['empresa',['antigo','e'],50],
]) test(`${tipo}: obra + mês, listagem, prévia, PDF, e-mail e comprovantes consistentes`,async()=>{
  const a=ambiente(); a.$('relTipo').value=tipo; a.$('filterLancTipo').value=tipo;
  const dados=await a.context.getDadosRelatorio();
  assert.deepEqual(Array.from(dados.lancs,l=>l.id),ids); assert.equal(dados.resumo.total,total);
  await a.context.loadLancs();
  assert.equal(a.$('lancList').querySelectorAll('.lanc-item').length,ids.length);
  assert.deepEqual(Array.from(a.$('lancList').querySelectorAll('.lanc-item-desc'),el=>el.textContent).sort(),[...ids].sort());
  await a.context.previewRelatorio();
  assert.equal(a.$('relPreviewContent').querySelectorAll('tbody')[0].querySelectorAll('tr').length,ids.length);
  assert.ok(a.$('relPreviewContent').textContent.includes(despesas.TIPOS_DESPESA[tipo]));
  for(const [label,valor] of dados.resumo.linhas) {
    assert.ok(a.$('relPreviewContent').textContent.includes(label));
    assert.ok(a.$('relPreviewContent').textContent.includes(valor.toLocaleString('pt-BR',{minimumFractionDigits:2})));
  }
  await a.context.gerarPDF(); await a.context.enviarRelatorioEmail();
  assert.equal(a.pdfs.length,2); assert.equal(a.envios.length,1);
  for(const pdf of a.pdfs) {
    const rows=pdf.tables.flatMap(t=>t.body).filter(r=>registros.some(l=>l.id===r[2]));
    assert.deepEqual(rows.map(r=>r[2]).sort(),[...ids].sort());
    assert.ok(pdf.textos.some(t=>t.includes('Tipo de despesa: '+despesas.TIPOS_DESPESA[tipo])));
    for(const [label,valor] of dados.resumo.linhas) {
      const moeda='R$ '+valor.toLocaleString('pt-BR',{minimumFractionDigits:2});
      assert.ok(pdf.tables.some(t=>t.body.some(r=>r[0]===label&&r[1]===moeda)) || pdf.textos.includes(label+': '+moeda),`Total exportado: ${label} ${moeda}`);
    }
  }
  const email=a.envios[0];
  for(const l of registros) assert.equal(email.corpo.includes(l.comprovante.url),ids.includes(l.id));
  assert.equal(a.writes[0].total,total); assert.equal(a.writes[0].tipo_despesa,tipo);
  if(tipo!=='todas') {
    const other=tipo==='empresa'?'Reembolsáveis:':'Empresa:';
    assert.ok(!a.$('relPreviewContent').textContent.includes(other));
    assert.ok(!email.corpo.includes(other));
  }
  a.dom.window.close();
});

test('colaborador, obras permitidas, perfil legado e perfil sem obra',async()=>{
  for(const profile of [{obras:['a','b']},{obra_id:'a'},{}]) {
    const a=ambiente('USER',profile);
    for(const tipo of ['todas','reembolsaveis','empresa']) {
      a.$('relTipo').value=tipo; a.$('relColab').value='u';
      const dados=await a.context.getDadosRelatorio();
      assert.ok(dados.lancs.every(l=>l.colaborador_uid==='u'&&l.obra_id==='a'));
      assert.equal(dados.lancs.length,profile.obras||profile.obra_id ? (tipo==='todas'?3:tipo==='empresa'?2:1) : 0);
    }
    a.$('relObra').value='b'; a.$('relTipo').value='todas';
    assert.equal((await a.context.getDadosRelatorio()).lancs.length,profile.obras?1:0);
    a.$('filterLancObra').value='b'; await a.context.loadLancs();
    assert.equal(a.$('lancList').querySelectorAll('.lanc-item').length,profile.obras?1:0);
    await a.context.enviarRelatorioEmail(); assert.equal(a.envios.length,0);
    a.dom.window.close();
  }
});

test('lista vazia para três tipos não exporta nem envia',async()=>{
  const a=ambiente(); a.$('relDe').value='2027-01-01'; a.$('relAte').value='2027-01-31'; a.$('filterLancMes').value='2027-01';
  for(const tipo of ['todas','reembolsaveis','empresa']) {
    a.$('relTipo').value=tipo; a.$('filterLancTipo').value=tipo;
    const dados=await a.context.getDadosRelatorio(); assert.equal(dados.resumo.total,0);
    await a.context.loadLancs(); assert.equal(a.$('lancList').querySelectorAll('.lanc-item').length,0);
    await a.context.previewRelatorio(); assert.match(a.$('relPreviewContent').textContent,/Nenhum lançamento/);
    await a.context.gerarPDF(); await a.context.enviarRelatorioEmail();
  }
  assert.equal(a.pdfs.length,0); assert.equal(a.envios.length,0); assert.equal(a.writes.length,0);
  a.dom.window.close();
});

test('filtros e metadados permanecem consistentes se controles mudam durante a consulta',async()=>{
  const a=ambiente(); a.$('relTipo').value='empresa';
  const pending=a.context.getDadosRelatorio(); a.$('relTipo').value='reembolsaveis'; a.$('relObra').value='b';
  const dados=await pending; assert.equal(dados.tipo,'empresa'); assert.equal(dados.obraNome,'Obra A');
  assert.deepEqual(Array.from(dados.lancs,l=>l.id),['antigo','e']); a.dom.window.close();
});
