export const TIPO_DESPESA = Object.freeze({
  TODAS: 'todas',
  REEMBOLSAVEIS: 'reembolsaveis',
  EMPRESA: 'empresa',
});

export function normalizarTipoDespesa(value) {
  return Object.values(TIPO_DESPESA).includes(value) ? value : TIPO_DESPESA.TODAS;
}

export function tipoDespesa(lancamento) {
  // Registros históricos sem o campo permanecem classificados como Empresa.
  return lancamento?.reembolsavel === true ? TIPO_DESPESA.REEMBOLSAVEIS : TIPO_DESPESA.EMPRESA;
}

export function rotuloTipoDespesa(value) {
  return ({
    [TIPO_DESPESA.TODAS]: 'Todas',
    [TIPO_DESPESA.REEMBOLSAVEIS]: 'Reembolsáveis',
    [TIPO_DESPESA.EMPRESA]: 'Empresa',
  })[normalizarTipoDespesa(value)];
}

export function obrasPermitidas(perfil) {
  const alocadas = Array.isArray(perfil?.obras) ? perfil.obras.filter(Boolean) : [];
  return [...new Set([...alocadas, ...(perfil?.obra_id ? [perfil.obra_id] : [])])];
}

export function limitarLancamentosPorPermissao(lancamentos, role, perfil) {
  const rows = Array.isArray(lancamentos) ? lancamentos : [];
  if (role === 'ADMIN') return [...rows];
  const permitidas = new Set(obrasPermitidas(perfil));
  return rows.filter(l => permitidas.has(l?.obra_id));
}

export function filtrarLancamentos(lancamentos, filtros = {}) {
  const tipo = normalizarTipoDespesa(filtros.tipo);
  const obraId = filtros.obraId || '';
  const colaboradorUid = filtros.colaboradorUid || '';
  const de = filtros.de || '';
  const ate = filtros.ate || '';
  return (Array.isArray(lancamentos) ? lancamentos : []).filter(l => {
    if (obraId && l?.obra_id !== obraId) return false;
    if (colaboradorUid && l?.colaborador_uid !== colaboradorUid) return false;
    if (de && (!l?.data || l.data < de)) return false;
    if (ate && (!l?.data || l.data > ate)) return false;
    if (tipo !== TIPO_DESPESA.TODAS && tipoDespesa(l) !== tipo) return false;
    return true;
  });
}

export function calcularTotaisDespesas(lancamentos) {
  const totais = { reembolsaveis: 0, empresa: 0, geral: 0, quantidade: 0 };
  for (const l of Array.isArray(lancamentos) ? lancamentos : []) {
    const valor = Number(l?.valor) || 0;
    totais[tipoDespesa(l)] += valor;
    totais.geral += valor;
    totais.quantidade++;
  }
  return totais;
}

export function linhasResumoDespesas(totais, filtroTipo) {
  const tipo = normalizarTipoDespesa(filtroTipo);
  if (tipo === TIPO_DESPESA.TODAS) return [
    { label: 'Subtotal Reembolsáveis', value: totais.reembolsaveis },
    { label: 'Subtotal Empresa', value: totais.empresa },
    { label: 'Total geral', value: totais.geral },
  ];
  return [{ label: `Total ${rotuloTipoDespesa(tipo)}`, value: totais.geral }];
}

function millis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis() || 0;
  if (typeof value.toDate === 'function') return value.toDate()?.getTime() || 0;
  if (value instanceof Date) return value.getTime() || 0;
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function ordenarLancamentosRecentes(lancamentos) {
  return (Array.isArray(lancamentos) ? lancamentos : [])
    .map((l, index) => ({ l, index }))
    .sort((a, b) => {
      const created = millis(b.l?.criadoEm) - millis(a.l?.criadoEm);
      if (created) return created;
      const refDate = String(b.l?.data || '').localeCompare(String(a.l?.data || ''));
      return refDate || a.index - b.index;
    })
    .map(item => item.l);
}
