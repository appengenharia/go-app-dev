import { MODO, validarConfig } from '../evolucao-parametrizada.mjs';
export function config() {
  const cfg = {
    modeloEvolucao: 2, modoCalculo: MODO, revisaoConfig: 1, tipoUnidade: 'Tracker', grupos: ['Setor A'],
    unidades: [
      { id: 'u1', nome: 'Tracker 37/36', grupo: 'Setor A' },
      { id: 'u2', nome: 'Tracker 36/35', grupo: 'Setor A' },
      { id: 'u3', nome: 'Tracker 35/34', grupo: '' },
      { id: 'u4', nome: 'Sem escopo', grupo: '' },
    ],
    macros: [
      { id: 'm1', nome: 'Civil', pesoFisico: 27, micros: [{ id: 's1', desc: 'Bacia de contenção', pesoFisico: 100, unidade: 'un', metasPorLocal: { u1: 1, u2: 3, u3: 2 } }] },
      { id: 'm2', nome: 'Montagem', pesoFisico: 73, micros: [{ id: 's2', desc: 'Estrutura', pesoFisico: 100, unidade: 't', metasPorLocal: { u2: 10 } }] },
    ],
  };
  cfg.itensPorId = validarConfig(cfg);
  return cfg;
}
export const entrada = (values = {}) => ({ unidId: 'u1', svcId: 's1', qtdHoje: 1, obs: '', fotoUrl: '', fotoUrlDepois: '', ...values });
export const registro = (values = {}) => ({ ...entrada(), data: '2026-09-01', cancelado: false, ...values });
export const autorizado = { role: 'USER', ativo: true, obras: ['obra'], permEvolucao: true };
