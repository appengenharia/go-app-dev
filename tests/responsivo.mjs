// Teste real de layout, isolado de Firebase. Use GO_PLAYWRIGHT_PATH se Playwright vier do runtime local.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require=createRequire(import.meta.url);
const { chromium }=require(process.env.GO_PLAYWRIGHT_PATH || 'playwright');
const root=fileURLToPath(new URL('../',import.meta.url));
const original=fs.readFileSync(path.join(root,'index.html'),'utf8');
const styles=[...original.slice(0,original.indexOf('</head>')).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[0]).join('\n');
const pageHTML=`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/evolucao-parametrizada.css">${styles}</head><body><script type="module">
import {criarInterface} from '/evolucao-parametrizada-ui.mjs';
import {config} from '/tests/fixture.mjs';
const cfg=config();
cfg.unidades=Array.from({length:14},(_,i)=>({id:'u'+(i+1),nome:'Tracker '+(37-i)+'/'+(36-i),grupo:'Setor A'}));
cfg.macros[0].nome='Recuperação das áreas erodidas';
cfg.macros[0].micros=Array.from({length:10},(_,i)=>({id:'serv'+i,desc:'Execução de bacia de contenção '+(i+1),unidade:'un',pesoFisico:10,metasPorLocal:Object.fromEntries(cfg.unidades.map(u=>[u.id,3]))}));
const ui=criarInterface({sdk:{},getContext:()=>({cfg,profile:{role:'ADMIN'}}),getState:()=>null,refresh:async()=>{},uploadPhoto:async()=>{}});
ui.openConfig();
</script></body></html>`;
const allowed=new Set(['evolucao-parametrizada-ui.mjs','evolucao-parametrizada.mjs','evolucao-parametrizada-store.mjs','evolucao-planejamento-ui.mjs','evolucao-parametrizada.css','tests/fixture.mjs']);
const server=http.createServer((req,res)=>{
  const name=(req.url || '').slice(1);
  if(!name) {res.setHeader('Content-Type','text/html; charset=utf-8');res.end(pageHTML);return;}
  if(!allowed.has(name)) {res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',name.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(path.join(root,name)));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try {
  browser=await chromium.launch({channel:process.env.GO_BROWSER_CHANNEL || 'msedge',headless:true});
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const [width,height] of [[1440,1000],[768,1024],[390,844],[320,700]]) {
    await page.setViewportSize({width,height});
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator('.ep-planning').waitFor();
    for(const action of ['expand','collapse']) {
      await page.locator(`[data-action="${action}"]`).click();
      const sizes=await page.evaluate(()=>{
        const modal=document.querySelector('.ep-planning'),button=document.querySelector('[data-action="save"]');
        return {viewport:innerWidth,doc:document.documentElement.scrollWidth,modal:modal.clientWidth,scroll:modal.scrollWidth,button:button.getBoundingClientRect().toJSON()};
      });
      assert.ok(sizes.doc<=width,`Página transborda em ${width}: ${JSON.stringify(sizes)}`);
      assert.ok(sizes.scroll<=sizes.modal+1,`Modal transborda em ${width}: ${JSON.stringify(sizes)}`);
      if(width>=1000) assert.ok(sizes.modal>=1300,`Editor não ocupa largura de desktop: ${sizes.modal}`);
      if(width<=700) assert.ok(sizes.modal>=width-2,`Editor não ocupa tela do celular: ${sizes.modal}`);
      assert.ok(sizes.button.top>=0 && sizes.button.bottom<=height,`Salvar fora da tela em ${width}: ${JSON.stringify(sizes)}`);
    }
    if(process.env.GO_UI_CAPTURE_DIR) {
      fs.mkdirSync(process.env.GO_UI_CAPTURE_DIR,{recursive:true});
      await page.screenshot({path:path.join(process.env.GO_UI_CAPTURE_DIR,`planejamento-${width}.png`)});
    }
    console.log(`Layout ${width}x${height}: sem scroll horizontal, botão Salvar visível, acordeões funcionais`);
  }
  assert.deepEqual(errors,[]);
} finally { await browser?.close(); await new Promise(r=>server.close(r)); }
