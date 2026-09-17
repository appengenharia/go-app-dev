// Motor puro. V1 e V2 sem este discriminador continuam nos cálculos legados.
export const MODO = 'fisico_percentual';
export const parametrizada = cfg => Number(cfg?.modeloEvolucao) === 2 && cfg?.modoCalculo === MODO;
export const percentual = (executado, previsto) => previsto > 0 ? Math.max(0, Math.min(100, executado / previsto * 100)) : 0;
export const chave = (local, micro) => local + '_' + micro;
export const micros = cfg => (cfg?.macros || []).flatMap(m => (m.micros || []).map(s => ({ ...s, macroId: m.id, macroNome: m.nome })));
export const ativo = s => s?.ativo !== false;
export const modoApontamento = cfg => cfg?.modoApontamento || 'quantidade';
export const quantidadeApontada = (cfg, meta, valor) => modoApontamento(cfg) === 'percentual' ? meta * valor / 100 : valor;
export function fecharPesos(macro) {
  const items = macro.micros.filter(ativo);
  if (items.length) items.at(-1).pesoFisico = Math.round((100 - items.slice(0,-1).reduce((n,s) => n + Number(s.pesoFisico || 0), 0)) * 100) / 100;
}
export function retirarServico(macro, id, motivo, novoId = null) {
  exigir(texto(motivo), 'Informe o motivo da retirada.');
  const s = macro.micros.find(s => s.id === id && ativo(s));
  exigir(s, 'Serviço ativo não encontrado.');
  const novo = novoId ? { ...s, id: novoId, ativo: true, metasPorLocal: { ...s.metasPorLocal }, substituiServicoId: s.id } : null;
  if (novo) { delete novo.motivoRetirada; delete novo.substituidoPorId; }
  s.ativo = false; s.motivoRetirada = motivo.trim();
  if (novo) { s.substituidoPorId = novo.id; macro.micros.push(novo); }
  fecharPesos(macro);
  return novo;
}
export const dataLocal = (date = new Date()) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');

const exigir = (ok, message, detail = {}) => { if (!ok) throw Object.assign(new Error(message), detail); };
const idValido = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(id) && !['__proto__', 'constructor', 'prototype'].includes(id);
const texto = v => typeof v === 'string' && v.trim().length > 0;
const positivo = v => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= Number.MAX_SAFE_INTEGER;
function validarPesos(items, label) {
  exigir(items.length > 0, `${label}: adicione ao menos um item.`);
  for (const item of items) {
    exigir(positivo(item.pesoFisico) && item.pesoFisico <= 100, `${label}: peso físico deve ser maior que 0 e até 100%.`, {itemId:item.id,field:'pesoFisico'});
    exigir(Math.abs(item.pesoFisico * 100 - Math.round(item.pesoFisico * 100)) < 0.000001, `${label}: use até duas casas decimais no peso.`, {itemId:item.id,field:'pesoFisico'});
  }
  exigir(items.reduce((sum, item) => sum + Math.round(item.pesoFisico * 100), 0) === 10000, `${label}: os pesos físicos devem somar 100%.`);
}

export function validarConfig(cfg, anterior = null) {
  exigir(parametrizada(cfg), 'Modelo percentual inválido.');
  exigir(!anterior || parametrizada(anterior), 'Conversão automática de V1/V2 antigo não permitida.');
  exigir(['quantidade','percentual'].includes(modoApontamento(cfg)), 'Forma de lançamento inválida.');
  exigir(texto(cfg.tipoUnidade), 'Informe o nome do tipo de local.');
  exigir(Array.isArray(cfg.grupos) && cfg.grupos.every(texto), 'Grupos inválidos.');
  exigir(new Set(cfg.grupos).size === cfg.grupos.length, 'Grupos duplicados.');
  exigir(Array.isArray(cfg.unidades) && cfg.unidades.length > 0, 'Cadastre ao menos um local.');
  const ids = new Set();
  const addId = id => { exigir(idValido(id) && !ids.has(id), 'IDs inválidos ou duplicados.'); ids.add(id); };
  const locais = new Set();
  cfg.unidades.forEach(u => {
    addId(u.id); locais.add(u.id);
    exigir(texto(u.nome), 'Local sem nome.');
    exigir(!u.grupo || cfg.grupos.includes(u.grupo), `Grupo do local ${u.nome} não existe.`);
  });
  exigir(Array.isArray(cfg.macros), 'Etapas inválidas.');
  try { validarPesos(cfg.macros, 'Etapas'); } catch(e) { e.macroId=e.itemId; e.field='pesoFisico'; throw e; }
  const itensPorId = {};
  cfg.macros.forEach(m => {
    try {
    addId(m.id);
    exigir(texto(m.nome), 'Etapa sem nome.');
    exigir(Array.isArray(m.micros), `Etapa ${m.nome} sem Serviços.`);
    try { validarPesos(m.micros.filter(ativo), `Serviços de ${m.nome}`); } catch(e) { e.svcId=e.itemId; throw e; }
    m.micros.forEach(s => {
      try {
      addId(s.id);
      exigir(s.ativo === undefined || typeof s.ativo === 'boolean', 'Estado do Serviço inválido.');
      exigir(Number.isFinite(s.pesoFisico) && s.pesoFisico >= 0, 'Não salve peso negativo ou inválido.', {field:'pesoFisico'});
      exigir(texto(s.desc) && texto(s.unidade), 'Serviço sem descrição ou unidade de medição.');
      exigir(s.metasPorLocal && typeof s.metasPorLocal === 'object' && !Array.isArray(s.metasPorLocal), `Metas inválidas: ${s.desc}.`);
      const metas = Object.entries(s.metasPorLocal);
      exigir(metas.length > 0, `Informe ao menos um local aplicável para ${s.desc}.`);
      metas.forEach(([id, qtd]) => {
        exigir(locais.has(id), `O Serviço ${s.desc} referencia um local inexistente.`);
        exigir(positivo(qtd), `A meta de ${s.desc} deve ser maior que zero.`, {localId:id});
      });
      itensPorId[s.id] = { macroId: m.id, unidade: s.unidade, metasPorLocal: { ...s.metasPorLocal }, ativo: ativo(s) };
      } catch (e) { e.svcId = s.id; throw e; }
    });
    } catch (e) { e.macroId = m.id; throw e; }
  });
  // Conservador: estruturas já persistidas não podem perder referências históricas.
  // Novos itens ainda no rascunho podem ser removidos livremente.
  if (anterior) {
    anterior.unidades.forEach(u => exigir(locais.has(u.id), 'Não remova locais já salvos; preserve as referências históricas.'));
    anterior.macros.forEach(m => exigir(cfg.macros.some(x => x.id === m.id), 'Não remova Etapas já salvas.'));
    micros(anterior).forEach(s => {
      const novo = itensPorId[s.id];
      exigir(novo && novo.macroId === s.macroId && novo.unidade === s.unidade, 'Não remova, mova de Etapa ou altere a unidade de medição de um Serviço já salvo.');
      const itemNovo = micros(cfg).find(x => x.id === s.id);
      if (!ativo(itemNovo)) {
        exigir(texto(itemNovo.motivoRetirada), 'Informe o motivo da retirada.');
        exigir(itemNovo.desc === s.desc && JSON.stringify(itemNovo.metasPorLocal) === JSON.stringify(s.metasPorLocal), 'Preserve descrição e metas do Serviço retirado.');
      }
      exigir(ativo(s) || !ativo(itemNovo), 'Serviço retirado não pode ser reativado; crie um novo Serviço.');
      Object.keys(s.metasPorLocal).forEach(id => exigir(novo.metasPorLocal[id] > 0, 'Não remova aplicações já salvas; preserve o histórico do local.'));
    });
  }
  return itensPorId;
}

export function podeProduzir(profile, obraId) {
  return profile?.role === 'ADMIN' || (profile?.role === 'USER' && profile.ativo !== false &&
    (profile.obra_id === obraId || (profile.obras || []).includes(obraId)) &&
    (profile.permEvolucao === true || profile.evolResponsavel === true));
}

export function validarLancamento(cfg, value, permitirInativo = false) {
  exigir(parametrizada(cfg), 'Esta operação exige configuração percentual.');
  const micro = micros(cfg).find(s => s.id === value.svcId);
  const local = cfg.unidades.find(u => u.id === value.unidId);
  exigir(micro && local && micro.metasPorLocal[local.id] > 0, 'Selecione um Serviço aplicável ao local.');
  exigir(ativo(micro) || permitirInativo, 'Serviço retirado do escopo não aceita novos lançamentos.');
  exigir(typeof value.qtdHoje === 'number' && Number.isFinite(value.qtdHoje) && value.qtdHoje >= 0 && value.qtdHoje <= Number.MAX_SAFE_INTEGER, 'Informe uma quantidade finita, maior ou igual a zero, dentro da precisão suportada.');
  exigir(typeof value.obs === 'string' && value.obs.length <= 10000, 'Observação inválida (máximo 10.000 caracteres).');
  exigir(typeof value.fotoUrl === 'string' && typeof value.fotoUrlDepois === 'string', 'Fotos inválidas.');
  return { micro, local };
}

export function calcular(cfg, registros) {
  const porMicro = {}, progresso = {}, locais = {};
  micros(cfg).forEach(s => {
    porMicro[s.id] = { previsto: Object.values(s.metasPorLocal).reduce((a, b) => a + b, 0), executado: 0, pct: 0 };
    Object.entries(s.metasPorLocal).forEach(([id, meta]) => {
      progresso[chave(id, s.id)] = { unidId: id, svcId: s.id, qtdTotal: meta, qtdExec: 0, pct: 0 };
    });
  });
  registros.filter(r => r.cancelado !== true).forEach(r => {
    const p = progresso[chave(r.unidId, r.svcId)];
    // Falhar explicitamente: não ocultar produção órfã ou inválida como se fosse zero.
    exigir(p && porMicro[r.svcId] && Number.isFinite(r.qtdHoje) && r.qtdHoje >= 0, 'Produção incompatível com o planejamento. Revise os registros antes de medir.');
    p.qtdExec += r.qtdHoje;
    porMicro[r.svcId].executado += r.qtdHoje;
  });
  Object.values(progresso).forEach(p => { p.pct = percentual(p.qtdExec, p.qtdTotal); p.saldo = p.qtdTotal - p.qtdExec; });
  Object.values(porMicro).forEach(p => { p.pct = percentual(p.executado, p.previsto); });
  const macrosCalculadas = {};
  let global = 0;
  cfg.unidades.forEach(u => { locais[u.id] = { pct: 0, planejado: 0, entregue: 0, aplicaveis: 0, concluidos: 0 }; });
  cfg.macros.forEach(m => {
    const pct = m.micros.filter(ativo).reduce((sum, s) => sum + porMicro[s.id].pct * s.pesoFisico / 100, 0);
    const contribuicao = pct * m.pesoFisico / 100;
    macrosCalculadas[m.id] = { pct, contribuicao };
    global += contribuicao;
    m.micros.filter(ativo).forEach(s => Object.entries(s.metasPorLocal).forEach(([id, meta]) => {
      const pesoLocal = m.pesoFisico * s.pesoFisico / 100 * meta / porMicro[s.id].previsto;
      const p = progresso[chave(id, s.id)], local = locais[id];
      local.planejado += pesoLocal;
      local.entregue += pesoLocal * p.pct / 100;
      local.aplicaveis++;
      if (p.qtdExec >= meta) local.concluidos++;
    }));
  });
  Object.values(locais).forEach(p => { p.pct = percentual(p.entregue, p.planejado); });
  return { global: Math.min(100, global), macros: macrosCalculadas, micros: porMicro, progresso, locais };
}

export function historicoCalculado(cfg, registros) {
  const dias = [...new Set(registros.map(r => r.data))].sort();
  return dias.map(data => ({ data, pctGlobal: calcular(cfg, registros.filter(r => r.data <= data)).global }));
}

export function prepararRegistro(cfg, entrada, anterior, { uid, timestamp, motivo = '', cancelar = false, data = dataLocal(), permitirInativo = false }) {
  exigir(!anterior?.cancelado, 'Lançamento cancelado não pode ser alterado.');
  exigir(!anterior || texto(motivo), 'Informe o motivo da correção/cancelamento.');
  const { micro, local } = validarLancamento(cfg, entrada, Boolean(anterior && permitirInativo && anterior.svcId === entrada.svcId));
  const registro = {
    ...(anterior || {}),
    modeloEvolucao: 2, modoCalculo: MODO, revisaoConfig: cfg.revisaoConfig,
    unidId: local.id, unidNome: local.nome,
    svcId: micro.id, svcDesc: micro.desc, microId: micro.id, microDesc: micro.desc,
    macroId: micro.macroId, macroNome: micro.macroNome, unidade: micro.unidade,
    qtdHoje: entrada.qtdHoje, qtdTotal: micro.metasPorLocal[local.id], obs: entrada.obs,
    fotoUrl: entrada.fotoUrl, fotoUrlDepois: entrada.fotoUrlDepois,
    tipoFoto: entrada.fotoUrl && entrada.fotoUrlDepois ? 'ambos' : entrada.fotoUrl ? 'antes' : entrada.fotoUrlDepois ? 'depois' : '',
    data: anterior?.data || data, criadoPor: anterior?.criadoPor || uid,
    criadoEm: anterior?.criadoEm || timestamp, atualizadoEm: timestamp,
    revisao: (anterior?.revisao || 0) + 1, cancelado: cancelar,
  };
  if (anterior) Object.assign(registro, { corrigidoPor: uid, corrigidoEm: timestamp, motivoCorrecao: motivo.trim() });
  if (cancelar) Object.assign(registro, { canceladoPor: uid, canceladoEm: timestamp, motivoCancelamento: motivo.trim() });
  const auditoria = {
    operacao: cancelar ? 'cancelamento' : anterior ? 'correcao' : 'criacao',
    revisao: registro.revisao, corrigidoPor: uid, corrigidoEm: timestamp,
    motivoCorrecao: anterior ? motivo.trim() : 'Lançamento diário',
    dadosAnteriores: anterior || null, dadosNovos: registro,
  };
  return { registro, auditoria };
}
