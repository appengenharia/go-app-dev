import { parametrizada, validarConfig, prepararRegistro, podeProduzir, micros, ativo } from './evolucao-parametrizada.mjs';

// SDK injetado para exercitar as mesmas operações no emulador, sem acessar Firebase remoto.
export function criarStore(sdk) {
  const { doc, collection, getDocsFromServer, runTransaction, serverTimestamp } = sdk;
  const novoId = db => doc(collection(db, '_idsLocais')).id; // cria referência, não grava coleção
  async function carregarRegistros(db, obraId) {
    const snap = await getDocsFromServer(collection(db, 'obras', obraId, 'evolRegistros'));
    return snap.docs.map(d => ({ ...d.data(), id: d.id }));
  }
  async function salvarConfig({ db, obraId, user }, cfg, revisaoEsperada, motivo = '') {
    const ref = doc(db, 'obras', obraId, 'evolConfig', 'main');
    return runTransaction(db, async tx => {
      const snap = await tx.get(ref);
      const perfil = await tx.get(doc(db, 'usuarios', user.uid));
      if (perfil.data()?.role !== 'ADMIN') throw new Error('Somente ADMIN pode alterar o planejamento.');
      const anterior = snap.exists() ? snap.data() : null;
      if ((anterior?.revisaoConfig || 0) !== revisaoEsperada) throw new Error('O planejamento foi alterado em outra sessão. Reabra a configuração.');
      const itensPorId = validarConfig(cfg, anterior);
      if (anterior && (!motivo.trim() || motivo.length > 2000)) throw new Error('Informe o motivo da alteração (até 2.000 caracteres).');
      const value = { ...anterior, ...cfg, itensPorId, revisaoConfig: revisaoEsperada + 1, atualizadoEm: serverTimestamp() };
      tx.set(ref, value);
      tx.set(doc(ref, 'auditoria', 'r' + value.revisaoConfig), {
        revisao: value.revisaoConfig, alteradoPor: user.uid, alteradoEm: value.atualizadoEm,
        operacao: anterior ? 'alteracao' : 'criacao', motivo: anterior ? motivo.trim() : 'Configuração inicial',
        dadosAnteriores: anterior, dadosNovos: value,
      });
      return value;
    });
  }
  async function salvarRegistro(context, { id, entrada, revisaoEsperada = 0, motivo = '', cancelar = false, operacaoId }) {
    const { db, obraId, user, cfg } = context;
    if (!user) throw new Error('Sessão expirada. Entre novamente.');
    const ref = doc(db, 'obras', obraId, 'evolRegistros', id);
    const auditRef = doc(ref, 'auditoria', 'r' + (revisaoEsperada + 1));
    return runTransaction(db, async tx => {
      const [snap, configSnap, perfil, auditSnap] = await Promise.all([
        tx.get(ref), tx.get(doc(db, 'obras', obraId, 'evolConfig', 'main')),
        tx.get(doc(db, 'usuarios', user.uid)), tx.get(auditRef),
      ]);
      if (!podeProduzir(perfil.data(), obraId)) throw new Error('Você não tem permissão de Evolução nesta obra.');
      // Repetição após perda da resposta: a mesma operação nunca duplica produção.
      if (auditSnap.exists() && auditSnap.data().operacaoId === operacaoId) return;
      const atualCfg = configSnap.data();
      if (!parametrizada(atualCfg) || atualCfg.revisaoConfig !== cfg.revisaoConfig) throw new Error('O planejamento mudou. Atualize a obra antes de lançar.');
      const anterior = snap.exists() ? snap.data() : null;
      const perfilAtual = perfil.data();
      if (anterior && !ativo(micros(atualCfg).find(s => s.id === anterior.svcId)) && perfilAtual.role !== 'ADMIN') throw new Error('Somente ADMIN pode corrigir histórico retirado.');
      if ((anterior?.revisao || 0) !== revisaoEsperada) throw new Error('Lançamento alterado em outra sessão. Reabra para conferir os novos dados.');
      const { registro, auditoria } = prepararRegistro(atualCfg, entrada, anterior, {
        uid: user.uid, timestamp: serverTimestamp(), motivo, cancelar, permitirInativo: perfilAtual.role === 'ADMIN',
      });
      tx.set(ref, registro);
      tx.set(auditRef, { ...auditoria, operacaoId });
    });
  }
  async function carregarAuditoria(db, obraId, id) {
    const snap = await getDocsFromServer(collection(db, 'obras', obraId, 'evolRegistros', id, 'auditoria'));
    return snap.docs.map(d => d.data()).sort((a, b) => a.revisao - b.revisao);
  }
  return { novoId, carregarRegistros, salvarConfig, salvarRegistro, carregarAuditoria };
}
