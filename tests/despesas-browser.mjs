// Validação funcional isolada: código real do DEV, jsPDF real, dados fictícios.
// Nenhuma conexão com Firebase nem envio de e-mail.
import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { JSDOM } from 'jsdom';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const dom=new JSDOM(html);
const styles=[...html.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)].map(m=>m[0]).join('\n');
const report=dom.window.document.getElementById('tab-relatorios').outerHTML;
const list=dom.window.document.getElementById('lancList').closest('.card').outerHTML;
dom.window.close();
const bloco=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
const scripts=bloco('  let allLancs = [];','  async function updateStatTotal()')+bloco('  async function getDadosRelatorio()','  async function verificarFechamentoMensal()');
const pageHTML=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${styles}
<style>body{display:block;padding:16px}.tab-panel{display:block!important}</style></head><body>${list}${report}
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js"></script>
<script type="module">
import { filtrarDespesas, resumirDespesas, normalizarTipo, TIPOS_DESPESA } from '/despesas.mjs';
const $=id=>document.getElementById(id), currentRole='ADMIN', currentUser={uid:'u'}, db={};
const registros=[{id:'reemb',valor:10,reembolsavel:true},{id:'empresa',valor:20,reembolsavel:false},{id:'antigo',valor:30}].map(l=>({...l,descricao:l.id,categoria:'Outros gastos',obra_id:'a',data:'2026-10-05',colaborador_uid:'u',colaborador_nome:'Colaborador teste',comprovante:{url:'https://example.test/'+l.id}}));
const collection=()=>null,getDocs=async()=>({docs:registros.map(l=>({id:l.id,data:()=>l}))});
const getDoc=async()=>({exists:()=>true,data:()=>({destinatarios:['teste@example.test']})}),doc=()=>null,setDoc=async()=>{},serverTimestamp=()=>null;
const setMsg=(id,msg)=>$(id).textContent=msg,toast=()=>{},CATEGORIAS_CORES={'Outros gastos':'#000'},APPS_SCRIPT_URL='https://example.test/never-send';
HTMLFormElement.prototype.submit=function(){window.emailPayload=JSON.parse(this.querySelector('input').value)};
${scripts}
window.App={loadLancs,previewRelatorio,gerarPDF,enviarRelatorioEmail};
for(const id of ['relObra','filterLancObra']) $(id).innerHTML='<option value="a">Obra de teste DEV</option>';
$('relDe').value='2026-10-01';$('relAte').value='2026-10-31';$('filterLancMes').value='2026-10';
await loadLancs();window.ready=true;
</script></body></html>`;
const server=http.createServer((req,res)=>{
  res.setHeader('Content-Type',req.url==='/despesas.mjs'?'text/javascript':'text/html; charset=utf-8');
  res.end(req.url==='/despesas.mjs'?fs.readFileSync(new URL('../despesas.mjs',import.meta.url)):pageHTML);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
const dir=new URL('./.runtime/despesas/',import.meta.url); fs.mkdirSync(dir,{recursive:true});
try {
  browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://example.test/**',r=>r.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.ready);
  for(const [tipo,count] of [['todas',3],['reembolsaveis',1],['empresa',2]]) {
    await page.selectOption('#filterLancTipo',tipo); await page.waitForFunction(n=>document.querySelectorAll('.lanc-item').length===n,count);
    await page.selectOption('#relTipo',tipo);await page.getByRole('button',{name:'👁️ Visualizar',exact:true}).click();
    await page.waitForFunction(n=>document.querySelectorAll('#relPreviewContent tbody:first-of-type tr').length>=n,count);
    const download=page.waitForEvent('download'); await page.getByRole('button',{name:'📄 Baixar PDF',exact:true}).click();
    const file=await download; const output=new URL(tipo+'.pdf',dir);await file.saveAs(output.pathname.replace(/^\/(\w:)/,'$1'));
    assert.ok(fs.readFileSync(output).subarray(0,8).toString().startsWith('%PDF-'));
    await page.evaluate(()=>App.enviarRelatorioEmail());
    const email=await page.evaluate(()=>window.emailPayload);
    assert.ok(Buffer.from(email.pdf,'base64').subarray(0,8).toString().startsWith('%PDF-'));
    for(const id of ['reemb','empresa','antigo']) assert.equal(email.corpo.includes('https://example.test/'+id),tipo==='todas'||(tipo==='empresa'?id!=='reemb':id==='reemb'));
    console.log(tipo+': listagem, prévia, download PDF real e PDF/comprovantes do e-mail OK');
  }
  for(const width of [1440,390,320]) {
    await page.setViewportSize({width,height:1000});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    assert.equal(overflow,false,'Transbordamento em '+width);
    await page.screenshot({path:new URL('layout-'+width+'.png',dir).pathname.replace(/^\/(\w:)/,'$1'),fullPage:true});
  }
  assert.deepEqual(errors,[]);
} finally {await browser?.close();await new Promise(r=>server.close(r));}
