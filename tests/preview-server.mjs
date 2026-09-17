import http from 'node:http';
import fs from 'node:fs';
const root=new URL('../',import.meta.url);
const allowed=new Set(['/evolucao-parametrizada.mjs','/evolucao-parametrizada-store.mjs','/evolucao-parametrizada-ui.mjs','/evolucao-parametrizada.css','/tests/preview.html','/tests/preview.mjs','/tests/fixture.mjs']);
http.createServer((req,res)=>{
  const path=new URL(req.url,'http://127.0.0.1').pathname;
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; font-src 'none'");
  if(path==='/base.css'){
    const html=fs.readFileSync(new URL('index.html',root),'utf8');
    res.setHeader('Content-Type','text/css; charset=utf-8');res.end([...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n'));return;
  }
  const file=path==='/'?'/tests/preview.html':path;
  if(!allowed.has(file)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',file.endsWith('.mjs')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');
  res.end(fs.readFileSync(new URL('.'+file,root)));
}).listen(4179,'127.0.0.1',()=>console.log('Preview isolado: http://127.0.0.1:4179 — sem acesso a serviços externos'));
