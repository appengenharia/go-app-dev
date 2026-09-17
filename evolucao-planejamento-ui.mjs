import { MODO, parametrizada, micros, ativo, fecharPesos, retirarServico, validarConfig } from './evolucao-parametrizada.mjs';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = v => Number(v || 0).toLocaleString('pt-BR', {maximumFractionDigits:2});
const soma = items => items.reduce((n,s) => n + Number(s.pesoFisico || 0), 0);
const distribuicao = valor => Math.abs(valor-100)<0.000001 ? '100% ✓' : `${fmt(valor)}% — ${valor<100 ? 'faltam' : 'excede'} ${fmt(Math.abs(100-valor))}%`;
const mensagem = e => (e.message || String(e)).replace(/Macros/g,'Etapas').replace(/Macro/g,'Etapa').replace(/Micros/g,'Serviços').replace(/Micro/g,'Serviço');

export function abrirPlanejamento({context, store, open, refresh}) {
  if (context.profile?.role !== 'ADMIN') throw new Error('Somente ADMIN pode alterar a configuração.');
  if (context.cfg && !parametrizada(context.cfg)) throw new Error('A configuração legada permanece no editor original.');
  const original = context.cfg;
  const cfg = structuredClone(original || {modeloEvolucao:2,modoCalculo:MODO,revisaoConfig:0,tipoUnidade:'Local',grupos:[],unidades:[],macros:[],permColab:false});
  const host = open('Planejamento físico da obra'), body = host.querySelector('[data-body]');
  host.querySelector('.ep-modal').classList.add('ep-planning');
  const states = new Map();
  if(original) {
    states.set('locais',false);
    cfg.macros.forEach(m=>{
      states.set(m.id,false);
      m.micros.forEach(s=>{states.set(s.id,false);states.set('metas-'+s.id,false);});
    });
  }
  let motivo = '', saving = false;
  const novoId = () => store.novoId(context.db);
  const saved = id => micros(original).some(s => s.id === id);
  const expanded = key => states.get(key) !== false ? 'open' : '';
  const clearError = () => {
    host.querySelector('[data-error]').textContent = '';
    body.querySelectorAll('[data-local-error]').forEach(el => { el.textContent = ''; });
    body.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
  };
  function remember() { body.querySelectorAll('details[data-key]').forEach(el => states.set(el.dataset.key,el.open)); }
  function service(s,m) {
    const items = m.micros.filter(ativo), automatico = items.at(-1)?.id === s.id;
    return `<details class="ep-card ep-service" data-key="${s.id}" data-micro="${s.id}" ${expanded(s.id)}>
      <summary><strong data-summary-name>${esc(s.desc || 'Novo Serviço')}</strong><span data-summary-weight>${fmt(s.pesoFisico)}%</span><span data-summary-unit>${esc(s.unidade)}</span><span data-summary-locals>${Object.keys(s.metasPorLocal).length} locais</span></summary>
      <div class="ep-row"><label>Serviço<input data-micro-field="desc" value="${esc(s.desc)}"></label>
      <label>Peso do Serviço na Etapa (%)<input type="number" min="0.01" max="100" step="0.01" data-micro-field="pesoFisico" value="${s.pesoFisico}" ${automatico?'readonly aria-readonly="true"':''}><small>${automatico?'Calculado: completa os 100% da Etapa':'Até duas casas decimais'}</small></label>
      <label>Unidade de medição<input data-micro-field="unidade" value="${esc(s.unidade)}" ${saved(s.id)?'disabled':''}></label></div>
      <details data-key="metas-${s.id}" ${expanded('metas-'+s.id)}><summary>Metas por local</summary>
        <div class="ep-metas">${cfg.unidades.map(u=>`<label>${esc(u.nome || 'Local sem nome')} — previsto<input type="number" min="0.000001" step="any" data-meta="${u.id}" value="${s.metasPorLocal[u.id]??''}" placeholder="Não se aplica"></label>`).join('')}</div>
      </details><p class="ep-error" data-local-error role="alert"></p>
      <div class="ep-row">${saved(s.id)?`<button class="btn btn-outline" data-action="retire" data-id="${s.id}">Retirar do escopo</button><button class="btn btn-outline" data-action="replace" data-id="${s.id}">Substituir Serviço</button>`:`<button class="btn btn-outline" data-action="remove-draft" data-id="${s.id}">Remover Serviço não salvo</button>`}</div>
    </details>`;
  }
  function render() {
    remember(); cfg.macros.forEach(fecharPesos);
    body.innerHTML = `<p class="ep-muted">Etapas distribuem 100% da obra. O último Serviço ativo completa automaticamente os 100% de sua Etapa. Alterações de pesos e metas recalculam o avanço vigente; o histórico é preservado.</p>
      <div class="ep-row"><label>Nome do tipo de local<input data-config="tipoUnidade" value="${esc(cfg.tipoUnidade)}"></label>
      <label>Forma de lançamento diário<select data-config="modoApontamento"><option value="quantidade" ${cfg.modoApontamento!=='percentual'?'selected':''}>Quantidade executada</option><option value="percentual" ${cfg.modoApontamento==='percentual'?'selected':''}>Percentual de avanço (%)</option></select></label></div>
      <div class="ep-row ep-toolbar"><button class="btn btn-outline" data-action="expand">Expandir tudo</button><button class="btn btn-outline" data-action="collapse">Recolher tudo</button></div>
      <details class="ep-card" data-key="locais" ${expanded('locais')}><summary>Locais / setores · ${cfg.unidades.length} locais</summary>
        <label>Grupos / setores (um por linha)<textarea data-config="grupos" rows="3">${esc(cfg.grupos.join('\n'))}</textarea></label>
        ${cfg.unidades.map(u=>`<div class="ep-row ep-card" data-local="${u.id}"><label>Nome<input data-local-field="nome" value="${esc(u.nome)}"></label><label>Grupo<select data-local-field="grupo"><option value="">Sem grupo</option>${cfg.grupos.map(g=>`<option ${g===u.grupo?'selected':''}>${esc(g)}</option>`).join('')}</select></label><button class="btn btn-outline" data-action="remove-local" data-id="${u.id}" ${original?.unidades.some(x=>x.id===u.id)?'disabled':''}>Remover local</button></div>`).join('')}
        <button class="btn btn-outline" data-action="add-local">+ Local</button></details>
      <h4 tabindex="-1" data-stages-title>Etapas — distribuição <span data-total-macros>${fmt(soma(cfg.macros))}</span>% / 100%</h4><p data-distribution-global></p><p class="ep-error" data-local-error role="alert"></p>
      ${cfg.macros.map(m=>`<details class="ep-card ep-stage" data-key="${m.id}" data-macro="${m.id}" ${expanded(m.id)}><summary><strong data-stage-name>${esc(m.nome || 'Nova Etapa')}</strong><span data-stage-weight>${fmt(m.pesoFisico)}% da obra</span><span>${m.micros.filter(ativo).length} serviços</span><span data-stage-total></span></summary>
        <div class="ep-row"><label>Etapa<input data-macro-field="nome" value="${esc(m.nome)}"></label><label>Peso da Etapa na Obra (%)<input data-macro-field="pesoFisico" type="number" min="0.01" max="100" step="0.01" value="${m.pesoFisico}"></label><button class="btn btn-outline" data-action="remove-macro" data-id="${m.id}" ${original?.macros.some(x=>x.id===m.id)?'disabled':''}>Remover Etapa</button></div>
        <p>Distribuição dos Serviços: <span data-total-micros="${m.id}"></span></p><p class="ep-error" data-stage-error data-local-error role="alert"></p>
        ${m.micros.filter(ativo).map(s=>service(s,m)).join('')}<button class="btn btn-outline" data-action="add-micro" data-id="${m.id}">+ Serviço</button>
        ${m.micros.some(s=>!ativo(s))?`<details data-key="retirados-${m.id}" ${states.get('retirados-'+m.id)?'open':''}><summary>Serviços retirados do escopo</summary>${m.micros.filter(s=>!ativo(s)).map(s=>`<div class="ep-card"><strong>${esc(s.desc)}</strong><p>Retirado · ${esc(s.unidade)} · ${esc(s.motivoRetirada)}</p><p>Referência: ${esc(s.id)}${s.substituidoPorId?' · substituído por '+esc(s.substituidoPorId):''}</p><p>${Object.entries(s.metasPorLocal).map(([id,meta])=>`${esc(cfg.unidades.find(u=>u.id===id)?.nome || id)}: ${fmt(meta)}`).join(' · ')}</p></div>`).join('')}</details>`:''}</details>`).join('')}
      <button class="btn btn-outline" data-action="add-macro">+ Etapa</button>
      ${original?`<label>Motivo da alteração<textarea data-reason maxlength="2000" rows="2" required>${esc(motivo)}</textarea></label>`:''}
      <div class="ep-planning-footer"><button class="btn btn-primary" data-action="save">Salvar planejamento</button><span data-save-status role="status"></span></div>`;
    totals();
  }
  function totals() {
    body.querySelector('[data-total-macros]').textContent = fmt(soma(cfg.macros));
    body.querySelector('[data-distribution-global]').textContent = distribuicao(soma(cfg.macros));
    body.querySelector('[data-distribution-global]').className = Math.abs(soma(cfg.macros)-100)<0.000001 ? 'ep-ok' : 'ep-error';
    cfg.macros.forEach(m=>{
      const el = body.querySelector(`[data-macro="${m.id}"]`), items = m.micros.filter(ativo);
      const invalid = !items.length || items.some(s=>s.pesoFisico<=0);
      const text = invalid ? 'O último Serviço precisa ter peso maior que 0%; reduza os anteriores.' : distribuicao(soma(items));
      el.querySelector('[data-stage-total]').textContent = text;
      el.querySelector('[data-stage-total]').classList.toggle('ep-error',invalid);
      el.querySelector('[data-stage-total]').classList.toggle('ep-ok',!invalid);
      el.querySelector('[data-total-micros]').textContent = text;
      el.querySelector('[data-stage-name]').textContent = m.nome || 'Nova Etapa';
      el.querySelector('[data-stage-weight]').textContent = fmt(m.pesoFisico)+'% da obra';
      items.forEach(s=>{
        const node=el.querySelector(`[data-micro="${s.id}"]`);
        node.querySelector('[data-summary-name]').textContent=s.desc || 'Novo Serviço';
        node.querySelector('[data-summary-weight]').textContent=fmt(s.pesoFisico)+'%';
        node.querySelector('[data-summary-unit]').textContent=s.unidade;
        node.querySelector('[data-summary-locals]').textContent=Object.keys(s.metasPorLocal).length+' locais';
        if (items.at(-1)===s) node.querySelector('[data-micro-field="pesoFisico"]').value=s.pesoFisico;
      });
    });
  }
  function edit(event) {
    if(saving) return;
    clearError(); const el=event.target;
    if(el.hasAttribute('data-reason')) motivo=el.value;
    if(el.dataset.config) cfg[el.dataset.config]=el.dataset.config==='grupos'?el.value.split('\n').map(s=>s.trim()).filter(Boolean):el.value;
    const local=cfg.unidades.find(u=>u.id===el.closest('[data-local]')?.dataset.local);
    if(local && el.dataset.localField) local[el.dataset.localField]=el.value;
    const m=cfg.macros.find(m=>m.id===el.closest('[data-macro]')?.dataset.macro);
    if(m && el.dataset.macroField) m[el.dataset.macroField]=el.dataset.macroField==='pesoFisico'?Number(el.value):el.value;
    const s=m?.micros.find(s=>s.id===el.closest('[data-micro]')?.dataset.micro);
    if(s && el.dataset.microField && !el.readOnly) s[el.dataset.microField]=el.dataset.microField==='pesoFisico'?Number(el.value):el.value;
    if(s && el.dataset.meta) { if(el.value==='') delete s.metasPorLocal[el.dataset.meta]; else s.metasPorLocal[el.dataset.meta]=Number(el.value); }
    if(m) fecharPesos(m);
    totals();
  }
  body.oninput=edit;
  body.onchange=event=>{ edit(event); if(event.target.dataset.config==='grupos' || event.target.dataset.localField==='nome') render(); };
  function showError(e) {
    const msg=mensagem(e); host.querySelector('[data-error]').textContent=msg;
    const target=(e.svcId && body.querySelector(`[data-micro="${e.svcId}"]`)) || (e.macroId && body.querySelector(`[data-macro="${e.macroId}"]`));
    const stage=e.macroId && body.querySelector(`[data-macro="${e.macroId}"]`);
    const specific=e.localId ? target?.querySelector(`[data-meta="${e.localId}"]`) : e.field==='pesoFisico' ? (target?.querySelector('input[data-micro-field="pesoFisico"]:not([readonly]),input[data-macro-field="pesoFisico"]') || stage?.querySelector('input[data-micro-field="pesoFisico"]:not([readonly])')) : null;
    const focus=specific || target?.querySelector('input:not([disabled]):not([readonly]),select') || (msg.includes('motivo')?body.querySelector('[data-reason]'):body.querySelector('[data-macro-field="pesoFisico"]')) || body.querySelector('input');
    if(target) (target.querySelector('[data-stage-error]') || target.querySelector('[data-local-error]')).textContent=msg;
    for(let p=target;p && p!==body;p=p.parentElement) if(p.tagName==='DETAILS') p.open=true;
    for(let p=focus?.parentElement;p && p!==body;p=p.parentElement) if(p.tagName==='DETAILS') p.open=true;
    focus?.setAttribute('aria-invalid','true'); focus?.focus(); focus?.scrollIntoView?.({block:'center',behavior:'smooth'});
  }
  body.onclick=async event=>{
    const button=event.target.closest('[data-action]'); if(!button || saving) return;
    const {action,id}=button.dataset;
    if(action==='expand' || action==='collapse') { body.querySelectorAll('details').forEach(el=>{el.open=action==='expand';}); remember(); return; }
    clearError();
    if(action==='save') {
      try {
        validarConfig(cfg,original);
        if(original && !motivo.trim()) throw new Error('Informe o motivo da alteração.');
        saving=true;
        const controls=[...body.querySelectorAll('input,textarea,select,button')], disabled=controls.map(e=>e.disabled);
        controls.forEach(e=>e.disabled=true);
        body.querySelector('[data-save-status]').textContent='Salvando…';
        try { await store.salvarConfig(context,cfg,original?.revisaoConfig||0,motivo); await refresh(); host.remove(); }
        finally { controls.forEach((e,i)=>e.disabled=disabled[i]); body.querySelector('[data-save-status]').textContent=''; saving=false; }
      } catch(e) { showError(e); }
      return;
    }
    if(action==='add-local') cfg.unidades.push({id:novoId(),nome:'',grupo:''});
    if(action==='remove-local' && !original?.unidades.some(u=>u.id===id)) { cfg.unidades=cfg.unidades.filter(u=>u.id!==id); cfg.macros.forEach(m=>m.micros.forEach(s=>delete s.metasPorLocal[id])); }
    if(action==='add-macro') cfg.macros.push({id:novoId(),nome:'',pesoFisico:cfg.macros.length?0:100,micros:[]});
    if(action==='remove-macro' && !original?.macros.some(m=>m.id===id)) cfg.macros=cfg.macros.filter(m=>m.id!==id);
    if(action==='add-micro') cfg.macros.find(m=>m.id===id).micros.push({id:novoId(),desc:'',unidade:'un',pesoFisico:0,metasPorLocal:{},ativo:true});
    if(action==='remove-draft' && !saved(id)) cfg.macros.forEach(m=>{m.micros=m.micros.filter(s=>s.id!==id);});
    if(action==='retire' || action==='replace') {
      const reason=prompt('Motivo da retirada/substituição:'); if(!reason?.trim()) return;
      if(!confirm('Este Serviço não será apagado. Seu histórico, fotos e auditorias serão preservados. Ele deixará de participar do planejamento vigente e dos novos lançamentos. O percentual atual da obra pode mudar. Confirmar?')) return;
      const m=cfg.macros.find(m=>m.micros.some(s=>s.id===id));
      const old=micros(original).find(s=>s.id===id), item=m.micros.find(s=>s.id===id);
      if(old) { item.desc=old.desc; item.unidade=old.unidade; item.pesoFisico=old.pesoFisico; item.metasPorLocal={...old.metasPorLocal}; }
      retirarServico(m,id,reason,action==='replace'?novoId():null);
    }
    render();
  };
  render();
  return host;
}
