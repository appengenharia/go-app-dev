import test from 'node:test';
import assert from 'node:assert/strict';
import { dataCorteLocal, dataReferenciaRegistro, formatarDataReferencia, hojeLocalISO, validarDataReferencia } from '../evolucao-fotos.mjs';
import { montarInformeEvolucao } from '../evolucao-compartilhamento.mjs';

test('data ISO retroativa é formatada sem conversão de fuso e data ausente não vira hoje', () => {
  assert.equal(validarDataReferencia('2024-02-29'), '2024-02-29');
  assert.equal(validarDataReferencia('2025-02-29'), '');
  assert.equal(formatarDataReferencia('2024-02-29'), '29/02/2024');
  assert.equal(formatarDataReferencia(''), 'Data não informada');
  assert.equal(dataReferenciaRegistro({ criadoEm: new Date('2026-10-05T00:00:00Z') }), '');
  assert.equal(hojeLocalISO(new Date(2026, 9, 5, 23, 55)), '2026-10-05');
  assert.equal(dataCorteLocal(7, new Date(2026, 9, 5, 23, 55)), '2026-09-28');
});

test('prévia de WhatsApp usa data e informações salvas, incluindo correção, sem enviar', () => {
  const preview = montarInformeEvolucao({
    obra: 'Inimutaba', responsavel: 'Joana', percentual: 12.5, correcao: true,
    registro: { data: '2024-11-03', unidNome: 'Bloco A', macroNome: 'Fundação', svcDesc: 'Concreto', unidade: 'm³', qtdHoje: 2, obs: 'Concretagem finalizada' },
  });
  assert.match(preview, /Evolução da obra: Inimutaba/);
  assert.match(preview, /Data do registro: 03\/11\/2024/);
  assert.match(preview, /Responsável: Joana/);
  assert.match(preview, /2 m³ executados · 12,5%/);
  assert.match(preview, /Registro atualizado após correção/);
});
