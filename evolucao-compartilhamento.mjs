import { dataReferenciaRegistro, formatarDataReferencia, validarDataReferencia } from './evolucao-fotos.mjs';

const CAMPOS_FOTO = [['fotoUrl', 'Antes'], ['fotoUrlDepois', 'Depois']];
const texto = value => typeof value === 'string' ? value.trim() : '';
const comparar = (a, b) => String(a || '').localeCompare(String(b || ''), 'pt-BR', { sensitivity: 'base' });
const semAcento = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const trechoSeguro = value => semAcento(value).replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'sem-descricao';

export function montarInformeDia({ data, local, responsavel, diario } = {}) {
  const dataValida = validarDataReferencia(data);
  if (!dataValida) throw new Error('Selecione uma data de referência válida para o informe.');

  const cidade = texto(local?.cidade);
  const estado = texto(local?.estado);
  const localFormatado = cidade ? (estado ? `${cidade} – ${estado}` : cidade) : (estado || '');
  const atividade = texto(diario?.observacao);
  const observacoes = texto(diario?.motivoParalisacao);
  const avisos = [];

  if (!diario) avisos.push('Não há Diário de Clima e Produção salvo para esta obra e data.');
  else {
    if (!atividade) avisos.push('A Observação do diário está vazia.');
    if (!observacoes) avisos.push('O campo Motivo principal / ocorrência do diário está vazio.');
  }
  if (!cidade) avisos.push('O cadastro da obra não tem Cidade; o Local ficará incompleto.');
  if (!texto(responsavel)) avisos.push('O perfil do usuário logado não tem nome ou identificação disponível.');

  const message = [
    '*INFORME DE ATIVIDADE*',
    `*Data:* ${formatarDataReferencia(dataValida)}`,
    `*Local:* ${localFormatado}`,
    `*Responsável pelo informe:* ${texto(responsavel)}`,
    '',
    '*Atividade:*',
    atividade,
    '',
    '*Observações:*',
    observacoes,
  ].join('\n');

  return { message, localFormatado, atividade, observacoes, avisos };
}

export function diarioDoDiaExiste(registro) {
  if (!registro || typeof registro !== 'object') return false;
  return registro.diarioClimaPreenchido === true
    || ['observacao', 'motivoParalisacao', 'clima', 'houveProducao', 'chuvaNivel', 'houveRaio'].some(campo => Object.hasOwn(registro, campo));
}

export function selecionarFotosDoDia(registros = [], dataSelecionada) {
  const data = validarDataReferencia(dataSelecionada);
  if (!data) throw new Error('Selecione uma data de referência válida para as fotos.');
  const rows = Array.isArray(registros) ? registros : [];
  const comFoto = rows.filter(row => CAMPOS_FOTO.some(([campo]) => texto(row?.[campo])));
  const semDataConfiavel = comFoto.filter(row => !dataReferenciaRegistro(row)).length;
  const doDia = comFoto
    .filter(row => dataReferenciaRegistro(row) === data)
    .sort((a, b) => comparar(a.unidNome, b.unidNome) || comparar(a.svcDesc || a.microDesc, b.svcDesc || b.microDesc) || comparar(a.id, b.id));

  const fotos = [];
  doDia.forEach((registro, index) => {
    CAMPOS_FOTO.forEach(([campo, tipo]) => {
      const url = texto(registro[campo]);
      if (!url) return;
      const extensao = campo === 'fotoUrl' ? 'antes' : 'depois';
      const nome = `${String(index + 1).padStart(3, '0')}_${trechoSeguro(registro.unidNome)}_${trechoSeguro(registro.svcDesc || registro.microDesc || registro.id)}_${extensao}`;
      fotos.push({
        id: `${registro.id || `lancamento-${index + 1}`}:${campo}`,
        registroId: registro.id || '',
        unidade: texto(registro.unidNome) || 'Unidade sem nome',
        servico: texto(registro.svcDesc || registro.microDesc) || 'Serviço sem nome',
        data,
        tipo,
        url,
        nomeBase: nome,
      });
    });
  });
  return { fotos, semDataConfiavel, totalRegistrosComFoto: comFoto.length };
}

export function extensaoFoto(blob, url = '') {
  const mime = String(blob?.type || '').toLowerCase().split(';')[0];
  const extensoes = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif', 'image/avif': 'avif' };
  if (extensoes[mime]) return extensoes[mime];
  try {
    const path = new URL(url).pathname;
    const match = /\.([a-z0-9]{2,5})$/i.exec(path);
    if (match && ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'avif'].includes(match[1].toLowerCase())) return match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
  } catch (_) { /* A extensão MIME é preferida; URL inválida será apontada no fetch. */ }
  return 'img';
}

export async function carregarArquivosFotos(fotos, { fetchImpl = globalThis.fetch, FileClass = globalThis.File } = {}) {
  const resultados = await Promise.all((Array.isArray(fotos) ? fotos : []).map(async foto => {
    try {
      const url = new URL(foto.url);
      if (url.protocol !== 'https:') throw new Error('A imagem não usa uma conexão HTTPS segura.');
      const response = await fetchImpl(url.href, { mode: 'cors', credentials: 'omit' });
      if (!response.ok) throw new Error(`O servidor respondeu HTTP ${response.status}.`);
      const blob = await response.blob();
      if (!blob.size) throw new Error('O arquivo recebido está vazio.');
      if (!String(blob.type || '').toLowerCase().startsWith('image/')) throw new Error('O endereço não retornou uma imagem.');
      if (typeof FileClass !== 'function') throw new Error('Este navegador não permite preparar arquivos para compartilhamento.');
      const name = `${foto.nomeBase}.${extensaoFoto(blob, url.href)}`;
      const file = new FileClass([blob], name, { type: blob.type || 'application/octet-stream', lastModified: 0 });
      return { ...foto, name, file, error: '' };
    } catch (error) {
      return { ...foto, name: '', file: null, error: error?.message || 'Falha desconhecida ao carregar a imagem.' };
    }
  }));
  return {
    fotos: resultados,
    arquivos: resultados.filter(row => row.file).map(row => row.file),
    falhas: resultados.filter(row => !row.file),
  };
}

const crcTabela = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = crcTabela[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function cabecalhoZip(tamanho, sig) {
  const buffer = new Uint8Array(tamanho);
  return { buffer, view: new DataView(buffer.buffer), sig };
}

export async function criarZipFotos(arquivos, { BlobClass = globalThis.Blob } = {}) {
  if (typeof BlobClass !== 'function') throw new Error('Este navegador não permite criar o arquivo ZIP.');
  const entries = [];
  for (const file of (Array.isArray(arquivos) ? arquivos : [])) {
    const name = String(file?.name || 'foto.img').replace(/[\\/]+/g, '_');
    const nameBytes = new TextEncoder().encode(name);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > 0xffffffff) throw new Error('Uma foto ultrapassa o tamanho suportado pelo arquivo ZIP.');
    entries.push({ name, nameBytes, bytes, crc: crc32(bytes) });
  }
  if (!entries.length) throw new Error('Não há fotos carregadas para baixar.');
  if (entries.length > 0xffff) throw new Error('O arquivo possui fotos demais para o formato ZIP.');

  const parts = [];
  let offset = 0;
  const central = [];
  for (const entry of entries) {
    const local = cabecalhoZip(30 + entry.nameBytes.length, 0x04034b50);
    const v = local.view;
    v.setUint32(0, local.sig, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true); v.setUint16(8, 0, true);
    v.setUint16(10, 0, true); v.setUint16(12, 0x21, true); v.setUint32(14, entry.crc, true);
    v.setUint32(18, entry.bytes.length, true); v.setUint32(22, entry.bytes.length, true);
    v.setUint16(26, entry.nameBytes.length, true); v.setUint16(28, 0, true);
    local.buffer.set(entry.nameBytes, 30);
    parts.push(local.buffer, entry.bytes);

    const directory = cabecalhoZip(46 + entry.nameBytes.length, 0x02014b50);
    const d = directory.view;
    d.setUint32(0, directory.sig, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true);
    d.setUint16(8, 0x0800, true); d.setUint16(10, 0, true); d.setUint16(12, 0, true); d.setUint16(14, 0x21, true);
    d.setUint32(16, entry.crc, true); d.setUint32(20, entry.bytes.length, true); d.setUint32(24, entry.bytes.length, true);
    d.setUint16(28, entry.nameBytes.length, true); d.setUint16(30, 0, true); d.setUint16(32, 0, true);
    d.setUint16(34, 0, true); d.setUint16(36, 0, true); d.setUint32(38, 0, true); d.setUint32(42, offset, true);
    directory.buffer.set(entry.nameBytes, 46);
    central.push(directory.buffer);
    offset += local.buffer.length + entry.bytes.length;
    if (offset > 0xffffffff) throw new Error('O conjunto de fotos ultrapassa o tamanho suportado pelo arquivo ZIP.');
  }
  const centralBytes = central.reduce((sum, part) => sum + part.length, 0);
  const end = cabecalhoZip(22, 0x06054b50);
  const e = end.view;
  e.setUint32(0, end.sig, true); e.setUint16(4, 0, true); e.setUint16(6, 0, true);
  e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true);
  e.setUint32(12, centralBytes, true); e.setUint32(16, offset, true); e.setUint16(20, 0, true);
  return new BlobClass([...parts, ...central, end.buffer], { type: 'application/zip' });
}

export async function carregarDadosInformeDia({ db, obraId, data, sdk } = {}) {
  const referencia = validarDataReferencia(data);
  if (!referencia) throw new Error('Data de referência inválida.');
  if (!obraId) throw new Error('Selecione uma obra.');
  const { doc, getDocFromServer, collection, getDocsFromServer } = sdk || {};
  if (![doc, getDocFromServer, collection, getDocsFromServer].every(fn => typeof fn === 'function')) throw new Error('Leitura atualizada do diário indisponível.');
  const obraRef = doc(db, 'obras', obraId);
  const diarioRef = doc(db, 'obras', obraId, 'evolHistorico', referencia);
  const registrosRef = collection(db, 'obras', obraId, 'evolRegistros');
  const [obraSnapshot, diarioSnapshot, registrosSnapshot] = await Promise.all([
    getDocFromServer(obraRef), getDocFromServer(diarioRef), getDocsFromServer(registrosRef),
  ]);
  return {
    obra: obraSnapshot.exists() ? obraSnapshot.data() : null,
    diario: diarioSnapshot.exists() ? diarioSnapshot.data() : null,
    registros: registrosSnapshot.docs.map(snapshot => ({ ...snapshot.data(), id: snapshot.id })),
  };
}

export { formatarDataReferencia, dataReferenciaRegistro };
