import { formatarDataReferencia } from './evolucao-fotos.mjs';

export function montarInformeEvolucao({ obra, registro, responsavel, percentual, correcao = false } = {}) {
  const linhas = [
    `Evolução da obra: ${obra || 'Obra não informada'}`,
    `Data do registro: ${formatarDataReferencia(registro?.data)}`,
    `Responsável: ${responsavel || 'Não informado'}`,
    `Local: ${registro?.unidNome || '—'}`,
    `Etapa: ${registro?.macroNome || '—'}`,
    `Serviço: ${registro?.svcDesc || registro?.microDesc || '—'}`,
    `Informações: ${Number(registro?.qtdHoje) || 0}${registro?.unidade ? ` ${registro.unidade}` : ''} executados${Number.isFinite(Number(percentual)) ? ` · ${Number(percentual).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%` : ''}`,
  ];
  if (registro?.obs) linhas.push(`Observação: ${registro.obs}`);
  if (correcao) linhas.push('Registro atualizado após correção.');
  return linhas.join('\n');
}
