import test from 'node:test';
import assert from 'node:assert/strict';
import { calcularTotaisDespesas, filtrarLancamentos, limitarLancamentosPorPermissao, linhasResumoDespesas, ordenarLancamentosRecentes, tipoDespesa, TIPO_DESPESA } from '../despesas.mjs';

const rows = [
  { id: 'new', obra_id: 'inimutaba', data: '2026-04-12', colaborador_uid: 'u1', reembolsavel: true, valor: 25, comprovante: { url: 'new.pdf' } },
  { id: 'legacy', obra_id: 'inimutaba', data: '2026-04-12', colaborador_uid: 'u1', valor: 10, comprovante: { url: 'legacy.pdf' } },
  { id: 'other', obra_id: 'outra', data: '2026-04-13', colaborador_uid: 'u2', reembolsavel: false, valor: 100 },
  { id: 'no-date', obra_id: 'inimutaba', colaborador_uid: 'u1', reembolsavel: false, valor: 5 },
];

test('classificação histórica ausente é Empresa; filtros obra, mês, colaborador e tipo se combinam', () => {
  assert.equal(tipoDespesa(rows[1]), TIPO_DESPESA.EMPRESA);
  const comum = { obraId: 'inimutaba', de: '2026-04-01', ate: '2026-04-30', colaboradorUid: 'u1' };
  assert.deepEqual(filtrarLancamentos(rows, { ...comum, tipo: TIPO_DESPESA.REEMBOLSAVEIS }).map(r => r.id), ['new']);
  assert.deepEqual(filtrarLancamentos(rows, { ...comum, tipo: TIPO_DESPESA.EMPRESA }).map(r => r.id), ['legacy']);
  assert.deepEqual(filtrarLancamentos(rows, { ...comum, tipo: TIPO_DESPESA.TODAS }).map(r => r.id), ['new', 'legacy']);
});

test('lista inclui registros sem criadoEm e ordena por data de referência quando não há timestamp', () => {
  const sorted = ordenarLancamentosRecentes([
    { id: 'old', data: '2025-02-01' },
    { id: 'missing-date' },
    { id: 'newer', data: '2025-10-01' },
  ]);
  assert.deepEqual(sorted.map(r => r.id), ['newer', 'old', 'missing-date']);
});

test('permissões incluem todas as obras alocadas; legado com obra_id continua compatível', () => {
  assert.deepEqual(limitarLancamentosPorPermissao(rows, 'USER', { obras: ['inimutaba', 'outra'], obra_id: 'inimutaba' }).map(r => r.id), rows.map(r => r.id));
  assert.deepEqual(limitarLancamentosPorPermissao(rows, 'USER', { obra_id: 'inimutaba' }).map(r => r.id), ['new', 'legacy', 'no-date']);
  assert.equal(limitarLancamentosPorPermissao(rows, 'ADMIN', {}).length, 4);
});

test('totais e subtotais batem com a seleção; lista vazia zera tudo', () => {
  const all = filtrarLancamentos(rows, { obraId: 'inimutaba', tipo: TIPO_DESPESA.TODAS });
  const totals = calcularTotaisDespesas(all);
  assert.deepEqual(totals, { reembolsaveis: 25, empresa: 15, geral: 40, quantidade: 3 });
  assert.deepEqual(linhasResumoDespesas(totals, TIPO_DESPESA.TODAS).map(x => x.value), [25, 15, 40]);
  const company = calcularTotaisDespesas(filtrarLancamentos(rows, { obraId: 'inimutaba', tipo: TIPO_DESPESA.EMPRESA }));
  assert.deepEqual(linhasResumoDespesas(company, TIPO_DESPESA.EMPRESA), [{ label: 'Total Empresa', value: 15 }]);
  assert.deepEqual(calcularTotaisDespesas([]), { reembolsaveis: 0, empresa: 0, geral: 0, quantidade: 0 });
});
