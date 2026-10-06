import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {validarDataReferencia} from '../evolucao-fotos.mjs';
import {carregarDadosInformeDia,diarioDoDiaExiste,montarInformeDia,selecionarFotosDoDia} from '../evolucao-compartilhamento.mjs';

const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
function trecho(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,`${start}`);return source.slice(a,b);}

test('fechar e corrigir diário retroativo prepara o informe com a data fechada e dados mais recentes do servidor',async()=>{
  const dom=new JSDOM(source),el=id=>dom.window.document.getElementById(id),data='2026-10-05',obraId='obra-real-simulada';
  const docs=new Map([[`obras/${obraId}`,{nome:'Obra simulada',cidade:'Inimutaba',estado:'MG'}]]),writes=[],reads=[],previews=[];
  const doc=(_db,...segments)=>({path:segments.join('/')});
  const collection=(_db,...segments)=>({path:segments.join('/')});
  const getDocFromServer=async ref=>{reads.push(ref.path);const value=docs.get(ref.path);return{exists:()=>Boolean(value),data:()=>value};};
  const getDocsFromServer=async ref=>{reads.push(ref.path);return{docs:(docs.get(ref.path)||[]).map(record=>({id:record.id,data:()=>record}))};};
  const prepare=async(id,date)=>{
    const saved=await carregarDadosInformeDia({db:{},obraId:id,data:date,sdk:{doc,collection,getDocFromServer,getDocsFromServer}});
    const diario=saved.diario;
    const report=montarInformeDia({data:date,local:saved.obra,responsavel:'Joana',diario});
    const photos=selecionarFotosDoDia(saved.registros,date);
    previews.push({date,report,photos});
  };
  const ctx=vm.createContext({document:dom.window.document,$:el,db:{},_eObraId:obraId,_eClimaPrintFile:null,_eHojeStr:()=> '2026-10-06',
    validarDataReferencia,doc,collection,getDocFromServer,getDocsFromServer,setDoc:async(ref,value)=>{writes.push(ref.path);docs.set(ref.path,{...docs.get(ref.path),...value});},serverTimestamp:()=>({serverTime:true}),
    currentUser:{uid:'responsavel'},currentProfile:{nome:'Joana'},currentRole:'ADMIN',_ePodeEditarDiario:()=>true,
    evolAtualizarCamposDiario:()=>{},_eCarregarHistorico:async()=>{},closeModal:()=>{},toast:()=>{},console,
    evolObrasPermitidasInforme:()=>[{value:obraId}],canEvoluirObra:()=>true,
    carregarDadosInformeDia,diarioDoDiaExiste,montarInformeDia,selecionarFotosDoDia,carregarArquivosFotos:async fotos=>({fotos,arquivos:[],falhas:[]}),criarZipFotos:async()=>null,
    abrirPreviaInformeDia:args=>{previews.push({date:args.report.message,report:args.report,fotos:args.fotos});return{};},
  });
  vm.runInContext(trecho('async function evolValidarPermissaoInforme(', 'function evolNomeResponsavelInforme(){')+trecho('function evolNomeResponsavelInforme(){','async function evolPrepararInformeDia(){')+trecho('async function evolPrepararInformeSalvo(', '\n  function _epResumo'),ctx);
  vm.runInContext(trecho('async function evolAbrirDiario(){','async function evolCarregarDiarioData(){')+trecho('async function evolCarregarDiarioData(){','function evolAtualizarCamposDiario()')+trecho('function evolAtualizarCamposDiario(){','function evolClimaFotoSel(')+trecho('async function evolSalvarDiario(){','// ─── Clima Visitante'),ctx);
  const photos=[
    {id:'retro-antes',data,fotoUrl:'https://img.test/antes.jpg'},
    {id:'retro-depois',data,fotoUrlDepois:'https://img.test/depois.jpg'},
    {id:'outro-dia',data:'2026-10-06',fotoUrl:'https://img.test/outro-dia.jpg'},
  ];
  docs.set(`obras/${obraId}/evolRegistros`,photos);
  el('evolDiaData').value=data;el('evolDiaObs').value='Observação original do dia 05';el('evolDiaMotivo').value='Ocorrência original';
  await vm.runInContext('evolSalvarDiario()',ctx);
  assert.deepEqual(writes,[`obras/${obraId}/evolHistorico/${data}`]);
  assert.equal(docs.get(`obras/${obraId}/evolHistorico/${data}`).observacao,'Observação original do dia 05');
  assert.equal(previews.length,1);
  assert.match(previews[0].report.message,/\*Data:\* 05\/10\/2026/);
  assert.match(previews[0].report.message,/Observação original do dia 05/);
  assert.match(previews[0].report.message,/Ocorrência original/);
  assert.deepEqual(previews[0].fotos.map(f=>f.id),['retro-antes:fotoUrl','retro-depois:fotoUrlDepois']);
  assert.ok(reads.includes(`obras/${obraId}/evolHistorico/${data}`));

  await vm.runInContext('evolAbrirDiario()',ctx);
  assert.equal(el('evolDiaData').value,data,'reabrir o diário preserva a data retroativa');
  assert.equal(el('evolDiaObs').value,'Observação original do dia 05','reabertura lê a versão do servidor');
  el('evolDiaObs').value='Observação corrigida do dia 05';el('evolDiaMotivo').value='Ocorrência corrigida';
  await vm.runInContext('evolSalvarDiario()',ctx);
  assert.equal(previews.length,2);
  assert.equal(docs.get(`obras/${obraId}/evolHistorico/${data}`).observacao,'Observação corrigida do dia 05');
  assert.match(previews[1].report.message,/\*Data:\* 05\/10\/2026/);
  assert.match(previews[1].report.message,/Observação corrigida do dia 05/);
  assert.match(previews[1].report.message,/Ocorrência corrigida/);
  assert.deepEqual(previews[1].fotos.map(f=>f.id),['retro-antes:fotoUrl','retro-depois:fotoUrlDepois']);
  assert.ok(reads.filter(path=>path===`obras/${obraId}/evolHistorico/${data}`).length>=3);
  dom.window.close();
});

test('data vazia não é trocada por hoje ao consultar ou salvar diário',async()=>{
  const dom=new JSDOM(source),el=id=>dom.window.document.getElementById(id),toasts=[];
  const ctx=vm.createContext({document:dom.window.document,$:el,_eObraId:'obra',_eHojeStr:()=> '2026-10-06',validarDataReferencia,toast:message=>toasts.push(message)});
  vm.runInContext(trecho('async function evolCarregarDiarioData(){','function evolAtualizarCamposDiario()')+trecho('function evolConsultarDiarioData(){','async function evolSalvarDiario()')+trecho('async function evolSalvarDiario(){','// ─── Clima Visitante'),ctx);
  el('evolDiaData').value='';el('evolClimaConsultaData').value='';
  await vm.runInContext('evolCarregarDiarioData()',ctx);
  vm.runInContext('evolConsultarDiarioData()',ctx);
  await vm.runInContext('evolSalvarDiario()',ctx);
  assert.equal(el('evolDiaData').value,'');
  assert.equal(toasts.length,3);
  assert.match(toasts.join(' '),/data.*diário|data de referência/i);
  dom.window.close();
});



