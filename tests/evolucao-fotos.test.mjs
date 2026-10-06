import test from 'node:test';
import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { dataCorteLocal, dataReferenciaRegistro, formatarDataReferencia, hojeLocalISO, validarDataReferencia } from '../evolucao-fotos.mjs';
import { carregarArquivosFotos, carregarDadosInformeDia, criarZipFotos, diarioDoDiaExiste, montarInformeDia, selecionarFotosDoDia } from '../evolucao-compartilhamento.mjs';

test('data ISO retroativa é formatada sem conversão de fuso e data ausente não vira hoje', () => {
  assert.equal(validarDataReferencia('2024-02-29'), '2024-02-29');
  assert.equal(validarDataReferencia('2025-02-29'), '');
  assert.equal(formatarDataReferencia('2024-02-29'), '29/02/2024');
  assert.equal(formatarDataReferencia(''), 'Data não informada');
  assert.equal(dataReferenciaRegistro({ criadoEm: new Date('2026-10-05T00:00:00Z') }), '');
  assert.equal(hojeLocalISO(new Date(2026, 9, 5, 23, 55)), '2026-10-05');
  assert.equal(dataCorteLocal(7, new Date(2026, 9, 5, 23, 55)), '2026-09-28');
});

test('informe usa somente o diário exato, a data retroativa, Cidade/Estado e responsável recebido', () => {
  const report = montarInformeDia({
    data: '2024-11-03', local: { cidade: 'Inimutaba', estado: 'MG', endereco: 'não usar' },
    responsavel: 'Joana Silva', diario: { data: '2024-11-03', observacao: 'Atividade única do diário', motivoParalisacao: 'Ocorrência do dia' },
  });
  assert.equal(report.message, '*INFORME DE ATIVIDADE*\n*Data:* 03/11/2024\n*Local:* Inimutaba – MG\n*Responsável pelo informe:* Joana Silva\n\n*Atividade:*\nAtividade única do diário\n\n*Observações:*\nOcorrência do dia');
  assert.doesNotMatch(report.message, /endereco|evolução|hoje/i);
});

test('Cidade sem Estado aparece sozinha; diário, localização e campos vazios ficam explícitos na prévia', () => {
  const report = montarInformeDia({ data: '2025-01-02', local: { cidade: 'Belo Horizonte' }, responsavel: 'Conta da Joana', diario: { observacao: '', motivoParalisacao: '' } });
  assert.match(report.message, /\*Local:\* Belo Horizonte/);
  assert.match(report.avisos.join('\n'), /Observação do diário está vazia/);
  assert.match(report.avisos.join('\n'), /Motivo principal \/ ocorrência do diário está vazio/);

  const missing = montarInformeDia({ data: '2025-01-02', local: {}, responsavel: '', diario: null });
  assert.match(missing.avisos.join('\n'), /Não há Diário/);
  assert.match(missing.avisos.join('\n'), /não tem Cidade/);
  assert.match(missing.avisos.join('\n'), /perfil do usuário logado/);
  assert.match(missing.message, /\*Atividade:\*\s+\*Observações:\*\s*$/);
  assert.throws(() => montarInformeDia({ data: '2025-02-29' }), /data de referência válida/);
});

test('diário só é considerado presente quando os campos reais do diário existem', () => {
  assert.equal(diarioDoDiaExiste({ data: '2024-01-01', pctGlobal: 40 }), false);
  assert.equal(diarioDoDiaExiste({ diarioClimaPreenchido: true }), true);
  assert.equal(diarioDoDiaExiste({ observacao: '' }), true);
});

test('fotos reúnem evoluções legadas e atuais apenas da obra/data consultadas, em ordem Antes e Depois', () => {
  const records = [
    { id: 'b', data: '2024-11-03', unidNome: 'Torre B', svcDesc: 'Pintura', fotoUrl: 'https://images.test/before.jpg', fotoUrlDepois: 'https://images.test/after.jpg', criadoEm: new Date() },
    { id: 'a', dataReferencia: '2024-11-03', unidNome: 'Torre A', microDesc: 'Concreto', fotoUrl: 'https://images.test/a.png' },
    { id: 'outro-dia', data: '2024-11-04', fotoUrl: 'https://images.test/wrong-day.jpg' },
    { id: 'sem-data', fotoUrlDepois: 'https://images.test/unknown-day.jpg', criadoEm: new Date() },
    { id: 'sem-foto', data: '2024-11-03', obs: 'sem fotos' },
  ];
  const result = selecionarFotosDoDia(records, '2024-11-03');
  assert.equal(result.fotos.length, 3);
  assert.equal(result.semDataConfiavel, 1);
  assert.deepEqual(result.fotos.map(photo => [photo.registroId, photo.tipo]), [['a', 'Antes'], ['b', 'Antes'], ['b', 'Depois']]);
  assert.ok(result.fotos.every(photo => photo.data === '2024-11-03'));
  assert.match(result.fotos[1].nomeBase, /^002_Torre_B_Pintura_antes$/);
  assert.throws(() => selecionarFotosDoDia(records, '2025-02-29'), /data de referência válida/);
});

test('dados do informe são lidos do documento exato da obra e da data e de todos os lançamentos dessa obra', async () => {
  const paths = [];
  const docs = {
    'obras/obra-a': { nome: 'Obra A', cidade: 'Cidade A', estado: 'MG' },
    'obras/obra-a/evolHistorico/2024-11-03': { observacao: 'Diário A', motivoParalisacao: 'Motivo A' },
    'obras/obra-a/evolRegistros': null,
  };
  const sdk = {
    doc: (_db, ...segments) => ({ path: segments.join('/') }),
    collection: (_db, ...segments) => ({ path: segments.join('/') }),
    getDocFromServer: async ref => { paths.push(ref.path); const value = docs[ref.path]; return { exists: () => Boolean(value), data: () => value }; },
    getDocsFromServer: async ref => { paths.push(ref.path); return { docs: [{ id: 'reg-a', data: () => ({ id: 'id-forjado', data: '2024-11-03', fotoUrl: 'https://images.test/a.jpg' }) }] }; },
  };
  const result = await carregarDadosInformeDia({ db: {}, obraId: 'obra-a', data: '2024-11-03', sdk });
  assert.deepEqual(paths.sort(), ['obras/obra-a', 'obras/obra-a/evolHistorico/2024-11-03', 'obras/obra-a/evolRegistros'].sort());
  assert.equal(result.diario.observacao, 'Diário A');
  assert.equal(result.registros[0].id, 'reg-a');
  await assert.rejects(() => carregarDadosInformeDia({ db: {}, obraId: 'obra-b', data: '2025-02-29', sdk }), /Data de referência inválida/);
});

test('falha individual de download aparece no resultado e não descarta silenciosamente arquivos', async () => {
  const photos = [
    { id: 'ok', url: 'https://images.test/ok.jpg', nomeBase: '001_Torre_A_antes', tipo: 'Antes' },
    { id: 'failed', url: 'https://images.test/missing.jpg', nomeBase: '002_Torre_B_depois', tipo: 'Depois' },
  ];
  const result = await carregarArquivosFotos(photos, {
    FileClass: File,
    fetchImpl: async url => url.endsWith('missing.jpg')
      ? ({ ok: false, status: 404 })
      : ({ ok: true, blob: async () => new Blob(['real image bytes'], { type: 'image/jpeg' }) }),
  });
  assert.equal(result.arquivos.length, 1);
  assert.equal(result.arquivos[0].name, '001_Torre_A_antes.jpg');
  assert.equal(result.falhas.length, 1);
  assert.equal(result.falhas[0].id, 'failed');
  assert.match(result.falhas[0].error, /HTTP 404/);
  assert.equal(result.fotos.length, 2);
});

test('pacote ZIP contém os nomes organizados e os bytes reais dos arquivos recebidos', async () => {
  const blob = await criarZipFotos([new File(['bytes-antes'], '001_Torre_A_Pintura_antes.jpg', { type: 'image/jpeg' }), new File(['bytes-depois'], '001_Torre_A_Pintura_depois.jpg', { type: 'image/jpeg' })]);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  assert.equal(blob.type, 'application/zip');
  assert.equal(new DataView(bytes.buffer).getUint32(0, true), 0x04034b50);
  assert.equal(new DataView(bytes.buffer).getUint32(bytes.length - 22, true), 0x06054b50);
  assert.match(text, /001_Torre_A_Pintura_antes\.jpg/);
  assert.match(text, /001_Torre_A_Pintura_depois\.jpg/);
  assert.match(text, /bytes-antes/);
  assert.match(text, /bytes-depois/);
  const view = new DataView(bytes.buffer);
  const extracted = [];
  let cursor = 0;
  while (view.getUint32(cursor, true) === 0x04034b50) {
    const nameLength = view.getUint16(cursor + 26, true), extraLength = view.getUint16(cursor + 28, true);
    const byteLength = view.getUint32(cursor + 22, true);
    const nameStart = cursor + 30, dataStart = nameStart + nameLength + extraLength;
    const name = new TextDecoder().decode(bytes.slice(nameStart, nameStart + nameLength));
    const contents = new TextDecoder().decode(bytes.slice(dataStart, dataStart + byteLength));
    extracted.push([name, contents]);
    cursor = dataStart + byteLength;
  }
  assert.equal(view.getUint32(cursor, true), 0x02014b50);
  assert.deepEqual(extracted, [
    ['001_Torre_A_Pintura_antes.jpg', 'bytes-antes'],
    ['001_Torre_A_Pintura_depois.jpg', 'bytes-depois'],
  ]);
  await assert.rejects(() => criarZipFotos([]), /Não há fotos carregadas/);
});
