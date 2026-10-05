export const TIPOS_DESPESA = { todas: 'Todas', reembolsaveis: 'Reembolsáveis', empresa: 'Empresa' };

export function normalizarTipo(tipo) {
  return Object.hasOwn(TIPOS_DESPESA, tipo) ? tipo : 'todas';
}

// Preserva a interpretação histórica: campo ausente/falso é Empresa.
export function tipoDespesa(lancamento) {
  return lancamento.reembolsavel ? 'reembolsaveis' : 'empresa';
}

export function filtrarDespesas(registros, filtros = {}, obrasPermitidas = null) {
  const tipo = normalizarTipo(filtros.tipo);
  return registros.filter(l =>
    (obrasPermitidas === null || obrasPermitidas.includes(l.obra_id)) &&
    (!filtros.obra || l.obra_id === filtros.obra) &&
    (!filtros.colaborador || l.colaborador_uid === filtros.colaborador) &&
    (!filtros.de || l.data >= filtros.de) &&
    (!filtros.ate || l.data <= filtros.ate) &&
    (tipo === 'todas' || tipoDespesa(l) === tipo)
  );
}

export function resumirDespesas(registros, tipo = 'todas') {
  tipo = normalizarTipo(tipo);
  let empresa = 0, reembolsaveis = 0;
  for (const l of registros) {
    if (tipoDespesa(l) === 'reembolsaveis') reembolsaveis += Number(l.valor || 0);
    else empresa += Number(l.valor || 0);
  }
  const total = empresa + reembolsaveis;
  const tituloTotal = tipo === 'todas' ? 'Total geral' : `Total — ${TIPOS_DESPESA[tipo]}`;
  return {
    total, empresa, reembolsaveis, tituloTotal,
    linhas: tipo === 'todas'
      ? [['Reembolsáveis', reembolsaveis], ['Empresa', empresa], [tituloTotal, total]]
      : [[tituloTotal, total]],
  };
}
