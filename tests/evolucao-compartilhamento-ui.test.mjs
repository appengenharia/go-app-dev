import test from 'node:test';
import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { JSDOM } from 'jsdom';
import { abrirPreviaInformeDia } from '../evolucao-compartilhamento-ui.mjs';

const report = { message: '*INFORME DE ATIVIDADE*\n*Data:* 03/11/2024', avisos: ['O motivo do diário está vazio.'] };

test('a prévia mostra fotos reais/falhas e só chama o compartilhamento nativo após o clique', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://dev.example/' });
  const file = new File(['image bytes'], '001_Torre_A_antes.jpg', { type: 'image/jpeg' });
  const failed = { id: 'bad', unidade: 'Torre A', servico: 'Pintura', tipo: 'Depois', file: null, error: 'HTTP 403' };
  const files = [file];
  const shares = [], canShareCalls = [];
  const navigatorObject = {
    canShare: value => { canShareCalls.push(value); return true; },
    share: async value => { shares.push(value); },
  };
  let id = 0;
  const URLClass = { createObjectURL: () => `blob:fake/${++id}`, revokeObjectURL: () => {} };
  const preview = abrirPreviaInformeDia({
    documentObject: dom.window.document, navigatorObject, URLClass, windowObject: dom.window,
    report, fotos: [{ id: 'ok', unidade: 'Torre A', servico: 'Pintura', tipo: 'Antes', file }, failed], falhas: [failed], zip: new Blob(['zip']),
  });
  assert.equal(shares.length, 0);
  assert.equal(canShareCalls[0].files[0], file);
  assert.equal(preview.element.querySelectorAll('img').length, 1);
  assert.match(preview.element.textContent, /1 carregada\(s\) · 1 falha\(s\)/);
  assert.match(preview.element.textContent, /HTTP 403/);
  preview.textarea.value += '\nTexto revisado pelo usuário';
  preview.nativeButton.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(shares.length, 1);
  assert.equal(shares[0].text, preview.textarea.value);
  assert.deepEqual(shares[0].files, files);
  assert.match(preview.element.querySelector('[data-status]').textContent, /Confirme no WhatsApp/);
  preview.close();
  assert.equal(dom.window.document.querySelector('[data-informe-preview]'), null);
});

test('sem canShare(files), a alternativa abre WhatsApp somente com texto e deixa ZIP para anexação manual', () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://dev.example/' });
  const opened = [];
  const downloads = [];
  dom.window.HTMLAnchorElement.prototype.click = function () { downloads.push({ href: this.href, name: this.download }); };
  const file = new File(['image bytes'], 'foto.jpg', { type: 'image/jpeg' });
  const navigatorObject = { canShare: () => false, share: () => { throw new Error('Não deve chamar'); } };
  let id = 0;
  const URLClass = { createObjectURL: () => `blob:fake/${++id}`, revokeObjectURL: () => {} };
  const preview = abrirPreviaInformeDia({
    documentObject: dom.window.document, navigatorObject, URLClass,
    windowObject: { open: (...args) => opened.push(args) }, report,
    fotos: [{ id: 'ok', unidade: 'A', servico: 'S', tipo: 'Antes', file }], zip: new Blob(['zip']), nomeZip: 'fotos.zip',
  });
  assert.equal(preview.nativeButton.hidden, true);
  assert.equal(preview.zipButton.disabled, false);
  preview.textarea.value = 'Mensagem revisada';
  preview.element.querySelector('[data-open-whatsapp]').click();
  assert.equal(opened.length, 1);
  assert.match(opened[0][0], /^https:\/\/wa\.me\/\?text=/);
  assert.match(decodeURIComponent(opened[0][0]), /Mensagem revisada/);
  assert.match(preview.element.querySelector('[data-status]').textContent, /somente com o texto/);
  assert.match(preview.element.querySelector('[data-download-photos]').textContent, /\.zip/i);
  preview.zipButton.click();
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].name, 'fotos.zip');
  assert.equal(downloads[0].href, 'blob:fake/2');
  preview.close();
});
