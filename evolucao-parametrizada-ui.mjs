import { abrirPlanejamento } from './evolucao-planejamento-ui.mjs';
import { parametrizada, micros, podeProduzir, chave, ativo, modoApontamento, quantidadeApontada } from './evolucao-parametrizada.mjs';
import { criarStore } from './evolucao-parametrizada-store.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = value => Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const stamp = value => value?.toDate ? value.toDate().toLocaleString('pt-BR') : '';

export function criarInterface({ sdk, getContext, getState, refresh, uploadPhoto }) {
  const store = criarStore(sdk);
  let modal;
  const usuarioCache = new Map();
  let usuariosCacheCarregado = false;

  async function carregarUsuarios(context) {
    if (usuariosCacheCarregado) return;
    try {
      const snap = await sdk.getDocsFromServer(sdk.collection(context.db, 'usuarios'));
      (snap.docs || []).forEach(d => {
        const u = d.data() || {};
        const nome = u.nome || u.email || d.id;
        usuarioCache.set(d.id, nome);
        if (u.uid) usuarioCache.set(u.uid, nome);
      });
      usuariosCacheCarregado = true;
    } catch (_) {
      // Histórico continua funcional; em falha de leitura usa UID como fallback.
    }
  }

  function nomeUsuario(uid) {
    return usuarioCache.get(uid) || uid || '—';
  }
  function open(title) {
    modal?.remove();
    modal = document.createElement('div');
    modal.className = 'modal-overlay ep-overlay';
    modal.innerHTML = `<section class="modal ep-modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="ep-row" style="justify-content:space-between;align-items:center"><h3>${esc(title)}</h3><button type="button" class="btn btn-outline sm" data-close>Fechar</button></div>
      <div data-body></div><p class="ep-error" role="alert" data-error></p></section>`;
    document.body.append(modal);
    modal.querySelector('[data-close]').onclick = () => modal.remove();
    return modal;
  }
  function error(host, e) { host.querySelector('[data-error]').textContent = e.message || String(e); }
  function requireEditor(context) {
    if (!podeProduzir(context.profile, context.obraId)) throw new Error('Você não tem permissão de Evolução nesta obra.');
  }
  async function busy(host, operation) {
    const controls = [...host.querySelectorAll('button,input,select,textarea')];
    const disabled = controls.map(el => el.disabled);
    controls.forEach(el => { el.disabled = true; });
    host.querySelector('[data-error]').textContent = '';
    try { await operation(); }
    catch (e) { error(host, e); }
    finally { controls.forEach((el, i) => { el.disabled = disabled[i]; }); }
  }

  function openConfig() { return abrirPlanejamento({context:getContext(), store, open, refresh}); }

  function renderSummary(container, side = 'e') {
    container.replaceChildren();
    const context = getContext(side), state = getState(side);
    if (!parametrizada(context.cfg) || !state) return;
    container.innerHTML = `<div class="ep-card" style="background:#fff;color:var(--text)"><h4>Avanço físico por Etapa</h4>
      ${context.cfg.macros.map(m => `<p class="ep-muted"><strong>${esc(m.nome)}</strong> · ${fmt(state.macros[m.id].pct)}% executado · Peso Físico ${fmt(m.pesoFisico)}% · contribuição ${fmt(state.macros[m.id].contribuicao)} p.p.</p>`).join('')}
      <p class="ep-muted">Avanço dos locais: indicador operacional. O global é calculado pelos pesos das Etapas e Serviços.</p>
      <div class="ep-row"><button class="btn btn-outline sm" data-history>Lançamentos e auditoria</button><button class="btn btn-outline sm" data-refresh>Atualizar produção</button></div></div>`;
    container.querySelector('[data-history]').onclick = () => openHistory(side);
    container.querySelector('[data-refresh]').onclick = async event => {
      event.target.disabled = true;
      try { await refresh(side); } catch (e) { event.target.textContent = 'Falha ao atualizar. Tentar novamente'; }
      finally { event.target.disabled = false; }
    };
  }

  function openUnit(uid, side = 'e') {
    const context = getContext(side), state = getState(side), cfg = context.cfg;
    const local = cfg.unidades.find(u => u.id === uid);
    if (!local || !state) return;
    const host = open(local.nome), body = host.querySelector('[data-body]');
    const edit = podeProduzir(context.profile, context.obraId);
    const aplicaveis = cfg.macros.filter(m => m.micros.some(s => ativo(s) && s.metasPorLocal[uid] > 0));
    body.innerHTML = `<p class="ep-muted">${esc(local.grupo)} · Avanço operacional: ${state.locais[uid].aplicaveis ? fmt(state.locais[uid].pct) + '%' : 'Sem planejamento'}</p>
      ${aplicaveis.map(m => `<div class="ep-card"><h4>${esc(m.nome)}</h4><p class="ep-muted">Etapa na obra: ${fmt(state.macros[m.id].pct)}% · Peso Físico ${fmt(m.pesoFisico)}% · contribuição ${fmt(state.macros[m.id].contribuicao)} p.p.</p>
        ${m.micros.filter(s => ativo(s) && s.metasPorLocal[uid] > 0).map(s => {
          const p = state.progresso[chave(uid,s.id)], total = state.micros[s.id];
          return `<div class="ep-card"><strong>${esc(s.desc)}</strong><p class="ep-muted">Peso Físico na Etapa: ${fmt(s.pesoFisico)}%<br>Local: previsto ${fmt(p.qtdTotal)} · executado ${fmt(p.qtdExec)} · saldo ${fmt(p.saldo)} ${esc(s.unidade)} · ${fmt(p.pct)}%<br>Serviço em toda a obra: ${fmt(total.executado)} / ${fmt(total.previsto)} ${esc(s.unidade)} · ${fmt(total.pct)}%</p>${edit ? `<button class="btn btn-primary sm" data-register="${s.id}">Lançar produção</button>` : ''}</div>`;
        }).join('')}</div>`).join('') || '<p>Não há Serviços previstos neste local.</p>'}
      <button class="btn btn-outline" data-history>Histórico deste local</button>`;
    body.querySelectorAll('[data-register]').forEach(button => { button.onclick = () => openRecord({ unidId: uid, svcId: button.dataset.register }, side); });
    body.querySelector('[data-history]').onclick = () => openHistory(side, uid);
  }

  function openRecord(initial = {}, side = 'e', anterior = null) {
    const context = getContext(side);
    try { requireEditor(context); } catch (e) { const h = open('Lançamento'); error(h,e); return; }
    const cfg = context.cfg, state = getState(side);
    if (anterior && !ativo(micros(cfg).find(s=>s.id===anterior.svcId)) && context.profile.role !== 'ADMIN') { const h=open('Histórico retirado'); error(h,new Error('Somente ADMIN pode corrigir histórico retirado.')); return; }
    const all = micros(cfg).filter(s=>ativo(s) || (anterior?.svcId===s.id && context.profile.role==='ADMIN'));
    const porPercentual = modoApontamento(cfg) === 'percentual';
    const host = open(anterior ? 'Editar lançamento' : 'Lançar produção'), body = host.querySelector('[data-body]');
    const id = anterior?.id || store.novoId(context.db), operacaoId = store.novoId(context.db);
    const photo = { fotoUrl: anterior?.fotoUrl || '', fotoUrlDepois: anterior?.fotoUrlDepois || '' };
    body.innerHTML = `<label>Local<select data-local>${cfg.unidades.map(u => `<option value="${u.id}">${esc(u.nome)}</option>`).join('')}</select></label>
      <label>Etapa<select data-macro></select></label><label>Serviço<select data-micro></select></label>
      <p class="ep-muted" data-balance></p>
      <label>${porPercentual ? 'Avanço (%)' : 'Quantidade executada'} ${anterior ? 'neste lançamento' : 'hoje'}<input data-quantity type="number" min="0" step="any" value="${anterior ? (porPercentual ? anterior.qtdHoje / all.find(s=>s.id===anterior.svcId).metasPorLocal[anterior.unidId] * 100 : anterior.qtdHoje) : ''}" inputmode="decimal"></label>
      <p class="ep-muted" data-preview></p>
      <label>Observação<textarea data-obs rows="3" maxlength="10000">${esc(anterior?.obs || '')}</textarea></label>
      <div class="ep-row">${[['fotoUrl','Antes'],['fotoUrlDepois','Depois']].map(([field,label]) => `<label>Foto ${label}<input data-photo="${field}" type="file" accept="image/*"><img data-photo-preview="${field}" ${photo[field] ? `src="${esc(photo[field])}"` : 'hidden'} alt="Foto ${label}"><button type="button" class="btn btn-outline sm" data-remove-photo="${field}">Remover ${label}</button></label>`).join('')}</div>
      ${anterior ? '<label>Motivo da correção<textarea data-reason rows="2" maxlength="2000" required></textarea></label>' : ''}
      <p class="ep-muted">Excedentes são preservados; percentuais ficam limitados a 100%. Antes e Depois são independentes.</p>
      <div class="modal-footer"><button class="btn btn-outline" data-back>Histórico</button><button class="btn btn-primary" data-save>Salvar lançamento</button></div>`;
    const localSel = body.querySelector('[data-local]'), macroSel = body.querySelector('[data-macro]'), microSel = body.querySelector('[data-micro]');
    localSel.value = anterior?.unidId || initial.unidId || cfg.unidades[0]?.id;
    function balance() {
      const s = all.find(s => s.id === microSel.value), p = state?.progresso[chave(localSel.value,microSel.value)];
      body.querySelector('[data-balance]').textContent = s && p ? `Previsto ${fmt(p.qtdTotal)} · executado ${fmt(p.qtdExec)} · saldo ${fmt(p.saldo)} ${s.unidade} · local ${fmt(p.pct)}% · Serviço na obra ${fmt(state.micros[s.id].pct)}%` : 'Nenhum Serviço aplicável a este local.';
      body.querySelector('[data-save]').disabled = !s;
      preview();
    }
    function fillMicros(preferred) {
      microSel.innerHTML = all.filter(s => s.macroId === macroSel.value && s.metasPorLocal[localSel.value] > 0).map(s => `<option value="${s.id}">${esc(s.desc)}</option>`).join('');
      if (preferred && [...microSel.options].some(o => o.value === preferred)) microSel.value = preferred;
      balance();
    }
    function fillMacros(preferredMicro) {
      macroSel.innerHTML = cfg.macros.filter(m => all.some(s => s.macroId === m.id && s.metasPorLocal[localSel.value] > 0)).map(m => `<option value="${m.id}">${esc(m.nome)}</option>`).join('');
      const selected = all.find(s => s.id === preferredMicro);
      if (selected && [...macroSel.options].some(o => o.value === selected.macroId)) macroSel.value = selected.macroId;
      fillMicros(preferredMicro);
    }
    function preview() {
      const p = state?.progresso[chave(localSel.value,microSel.value)];
      const value = body.querySelector('[data-quantity]').value;
      const retirada = anterior && anterior.unidId === localSel.value && anterior.svcId === microSel.value ? anterior.qtdHoje : 0;
      const next = p ? p.qtdExec - retirada + quantidadeApontada(cfg,p.qtdTotal,Number(value)) : 0;
      body.querySelector('[data-preview]').textContent = p && value !== '' && Number(value) >= 0 ? `Após salvar: ${fmt(next / p.qtdTotal * 100)}% · restante ${fmt(Math.max(0,100-next/p.qtdTotal*100))}% · quantidade ${fmt(next)}${next > p.qtdTotal ? ' · excedente preservado no histórico' : ''}` : '';
    }
    localSel.onchange = () => fillMacros(); macroSel.onchange = () => fillMicros(); microSel.onchange = balance;
    body.querySelector('[data-quantity]').oninput = preview;
    fillMacros(anterior?.svcId || initial.svcId);
    body.querySelectorAll('[data-photo]').forEach(input => {
      input.onchange = () => {
        const file = input.files[0]; if (!file) return;
        const field = input.dataset.photo, img = body.querySelector(`[data-photo-preview="${field}"]`);
        if (img.dataset.objectUrl) URL.revokeObjectURL(img.dataset.objectUrl);
        img.dataset.objectUrl = URL.createObjectURL(file); img.src = img.dataset.objectUrl; img.hidden = false;
      };
    });
    body.querySelectorAll('[data-remove-photo]').forEach(button => { button.onclick = () => {
      const field = button.dataset.removePhoto; photo[field] = '';
      body.querySelector(`[data-photo="${field}"]`).value = '';
      const img = body.querySelector(`[data-photo-preview="${field}"]`); img.hidden = true; img.removeAttribute('src');
    }; });
    body.querySelector('[data-back]').onclick = () => openHistory(side);
    body.querySelector('[data-save]').onclick = () => busy(host, async () => {
      const qtyInput = body.querySelector('[data-quantity]');
      if (!qtyInput.value.trim() || !qtyInput.validity.valid) throw new Error('Informe uma quantidade válida.');
      const motivo = body.querySelector('[data-reason]')?.value.trim() || '';
      if (anterior && !motivo) throw new Error('Informe o motivo da correção.');
      for (const field of ['fotoUrl','fotoUrlDepois']) {
        const input = body.querySelector(`[data-photo="${field}"]`);
        if (input.files[0]) { photo[field] = await uploadPhoto(input.files[0]); input.value = ''; }
      }
      await store.salvarRegistro(context, { id, operacaoId, revisaoEsperada: anterior?.revisao || 0, motivo,
        entrada: { unidId: localSel.value, svcId: microSel.value, qtdHoje: quantidadeApontada(cfg,all.find(s=>s.id===microSel.value).metasPorLocal[localSel.value],Number(qtyInput.value)), obs: body.querySelector('[data-obs]').value.trim(), ...photo } });
      body.innerHTML = '<p>Lançamento salvo. Atualizando os totais…</p>';
      await refresh(side); host.remove();
    });
  }

  async function openHistory(side = 'e', local = '') {
    const context = getContext(side), host = open('Lançamentos e auditoria'), body = host.querySelector('[data-body]');
    body.textContent = 'Carregando histórico completo…';

    const auditOpLabel = op => ({
      criacao: 'Criação',
      correcao: 'Correção',
      cancelamento: 'Cancelamento',
    }[op] || op || 'Alteração');

    const vazio = value => value === undefined || value === null || value === '';
    const textoValor = value => vazio(value) ? '—' : String(value);
    const diferente = (a, b) => String(a ?? '') !== String(b ?? '');

    function renderCriacao(a) {
      const d = a.dadosNovos || {};
      return `<div class="ep-card" style="margin-top:10px">
        <strong>Dados do lançamento</strong>
        <p class="ep-muted" style="margin-top:8px">
          Local: ${esc(textoValor(d.unidNome))}<br>
          Etapa: ${esc(textoValor(d.macroNome))}<br>
          Serviço: ${esc(textoValor(d.svcDesc || d.microDesc))}<br>
          Quantidade: ${fmt(d.qtdHoje)} ${esc(d.unidade || '')}<br>
          ${d.obs ? `Observação: ${esc(d.obs)}<br>` : ''}
          Foto Antes: ${d.fotoUrl ? 'Sim' : 'Não'}<br>
          Foto Depois: ${d.fotoUrlDepois ? 'Sim' : 'Não'}
        </p>
      </div>`;
    }

    function renderAlteracoes(a) {
      const ant = a.dadosAnteriores || {};
      const novo = a.dadosNovos || {};
      const itens = [];

      const pushTexto = (label, antes, depois) => {
        if (!diferente(antes, depois)) return;
        itens.push(`<div style="margin:8px 0"><strong>${esc(label)}:</strong><br>${esc(textoValor(antes))} → ${esc(textoValor(depois))}</div>`);
      };

      pushTexto('Local', ant.unidNome, novo.unidNome);
      pushTexto('Etapa', ant.macroNome, novo.macroNome);
      pushTexto('Serviço', ant.svcDesc || ant.microDesc, novo.svcDesc || novo.microDesc);

      if (diferente(ant.qtdHoje, novo.qtdHoje)) {
        itens.push(`<div style="margin:8px 0"><strong>Quantidade executada:</strong><br>${fmt(ant.qtdHoje)} ${esc(ant.unidade || '')} → ${fmt(novo.qtdHoje)} ${esc(novo.unidade || '')}</div>`);
      }

      pushTexto('Observação', ant.obs, novo.obs);

      const pushFoto = (label, antes, depois) => {
        if (!diferente(antes, depois)) return;
        const status = !antes && depois ? 'adicionada' : antes && !depois ? 'removida' : 'alterada';
        itens.push(`<div style="margin:8px 0"><strong>${esc(label)}:</strong> ${status}</div>`);
      };

      pushFoto('Foto Antes', ant.fotoUrl, novo.fotoUrl);
      pushFoto('Foto Depois', ant.fotoUrlDepois, novo.fotoUrlDepois);

      if (Boolean(ant.cancelado) !== Boolean(novo.cancelado)) {
        itens.push(`<div style="margin:8px 0"><strong>Status:</strong><br>${ant.cancelado ? 'Cancelado' : 'Ativo'} → ${novo.cancelado ? 'Cancelado' : 'Ativo'}</div>`);
      }

      return itens.length
        ? `<div class="ep-card" style="margin-top:10px"><strong>Alterações</strong>${itens.join('')}</div>`
        : '<p class="ep-muted">Nenhuma alteração de negócio identificada nesta revisão.</p>';
    }

    function renderAuditoria(a) {
      const op = auditOpLabel(a.operacao);
      const usuario = nomeUsuario(a.corrigidoPor);
      const motivo = a.operacao === 'cancelamento'
        ? (a.dadosNovos?.motivoCancelamento || a.motivoCorrecao || '')
        : (a.operacao === 'criacao' ? '' : (a.motivoCorrecao || ''));

      const resumo = a.operacao === 'criacao' ? renderCriacao(a) : renderAlteracoes(a);

      return `<div class="ep-card">
        <strong>Revisão ${a.revisao} · ${esc(op)}</strong>
        <p class="ep-muted">
          ${esc(stamp(a.corrigidoEm))}<br>
          <strong>Usuário:</strong> ${esc(usuario)}
          ${motivo ? `<br><strong>Motivo:</strong> ${esc(motivo)}` : ''}
        </p>
        ${resumo}
      </div>`;
    }

    try {
      const registros = await store.carregarRegistros(context.db, context.obraId);
      await carregarUsuarios(context);

      let page = 0;
      const edit = podeProduzir(context.profile, context.obraId);

      body.innerHTML = `<label>Local<select data-filter><option value="">Todos os locais</option>${context.cfg.unidades.map(u => `<option value="${u.id}">${esc(u.nome)}</option>`).join('')}</select></label><p class="ep-muted">Inclui registros sem foto e cancelados. Cancelados não entram na medição.</p><div data-records></div><div class="ep-row"><button class="btn btn-outline" data-prev>Anterior</button><button class="btn btn-outline" data-next>Próxima</button></div>`;
      body.querySelector('[data-filter]').value = local;

      function render() {
        const filter = body.querySelector('[data-filter]').value;
        const rows = registros
          .filter(r => !filter || r.unidId === filter)
          .sort((a,b) => b.data.localeCompare(a.data) || (b.criadoEm?.seconds || 0) - (a.criadoEm?.seconds || 0));

        body.querySelector('[data-records]').innerHTML = rows.slice(page*25,(page+1)*25).map(r => {
          const autor = nomeUsuario(r.criadoPor);
          let alteracao = '';

          if (r.cancelado) {
            alteracao = `<br>Cancelado por: ${esc(nomeUsuario(r.canceladoPor || r.corrigidoPor))}${r.motivoCancelamento ? ' · ' + esc(r.motivoCancelamento) : ''}`;
          } else if (r.motivoCorrecao) {
            alteracao = `<br>Última correção: ${esc(nomeUsuario(r.corrigidoPor))} · ${esc(r.motivoCorrecao)}`;
          }

          return `<article class="ep-card ${r.cancelado ? 'ep-cancelado' : ''}"><strong>${esc(r.data)} · ${esc(r.unidNome)} · ${esc(r.svcDesc)}</strong>
            <p>${fmt(r.qtdHoje)} ${esc(r.unidade)} ${r.cancelado ? '· CANCELADO' : ''}</p>
            <p class="ep-muted">${esc(r.obs)}<br>Autor: ${esc(autor)}${alteracao}</p>
            <div class="ep-row">${edit && !r.cancelado && (context.profile.role === 'ADMIN' || ativo(micros(context.cfg).find(s=>s.id===r.svcId))) ? `<button class="btn btn-outline sm" data-edit="${r.id}">Editar lançamento</button><button class="btn btn-outline sm" data-cancel="${r.id}">Cancelar lançamento</button>` : ''}<button class="btn btn-outline sm" data-audit="${r.id}">Auditoria</button></div>
          </article>`;
        }).join('') || '<p>Nenhum lançamento.</p>';

        body.querySelector('[data-prev]').disabled = page === 0;
        body.querySelector('[data-next]').disabled = (page+1)*25 >= rows.length;
      }

      body.querySelector('[data-filter]').onchange = () => { page=0; render(); };
      body.querySelector('[data-prev]').onclick = () => { page--; render(); };
      body.querySelector('[data-next]').onclick = () => { page++; render(); };

      body.querySelector('[data-records]').onclick = async event => {
        const btn = event.target.closest('button');
        if (!btn) return;

        const id = btn.dataset.edit || btn.dataset.cancel || btn.dataset.audit;
        const registro = registros.find(r => r.id === id);
        if (!registro) return;

        if (btn.dataset.edit) openRecord({}, side, registro);

        if (btn.dataset.cancel) {
          const motivo = prompt('Motivo do cancelamento (o registro permanecerá no histórico):');
          if (!motivo?.trim()) return;

          await busy(host, async () => {
            await store.salvarRegistro(context, {
              id,
              entrada: registro,
              revisaoEsperada: registro.revisao,
              motivo,
              cancelar: true,
              operacaoId: store.novoId(context.db)
            });
            await refresh(side);
            await openHistory(side, local);
          });
        }

        if (btn.dataset.audit) {
          await busy(host, async () => {
            const audits = await store.carregarAuditoria(context.db, context.obraId, id);
            await carregarUsuarios(context);
            const h = open('Auditoria do lançamento');
            h.querySelector('[data-body]').innerHTML = audits.map(renderAuditoria).join('') || '<p>Nenhuma auditoria encontrada.</p>';
          });
        }
      };

      render();
    } catch (e) {
      body.textContent = 'Não foi possível carregar os lançamentos. Feche e tente novamente.';
      error(host,e);
    }
  }
  async function changePhoto(side, id, field, input = null) {
    if (!['fotoUrl','fotoUrlDepois'].includes(field)) return;
    const context = getContext(side);
    const host = open('Corrigir foto do lançamento');
    await busy(host, async () => {
      requireEditor(context);
      const motivo = prompt('Informe o motivo da correção da foto:');
      if (!motivo?.trim()) { host.remove(); return; }
      const registros = await store.carregarRegistros(context.db, context.obraId), r = registros.find(r => r.id === id);
      if (!r) throw new Error('Lançamento não encontrado.');
      const value = input?.files?.[0] ? await uploadPhoto(input.files[0]) : '';
      await store.salvarRegistro(context, { id, entrada: { ...r, [field]: value }, revisaoEsperada: r.revisao, motivo, operacaoId: store.novoId(context.db) });
      await refresh(side); host.remove();
    });
  }
  return { ...store, openConfig, openUnit, openRecord, openHistory, renderSummary, changePhoto };
}
