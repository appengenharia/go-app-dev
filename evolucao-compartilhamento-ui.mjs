const node = (documentObject, tag, attributes = {}, text = '') => {
  const element = documentObject.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (name === 'class') element.className = value;
    else if (name === 'style') element.setAttribute('style', value);
    else if (name === 'hidden') element.hidden = Boolean(value);
    else element.setAttribute(name, value);
  }
  if (text) element.textContent = text;
  return element;
};

export function abrirPreviaInformeDia({
  documentObject = globalThis.document,
  navigatorObject = globalThis.navigator,
  URLClass = globalThis.URL,
  windowObject = globalThis.window,
  report,
  fotos = [],
  falhas = [],
  fotosSemData = 0,
  zip = null,
  nomeZip = 'fotos_do_informe.zip',
} = {}) {
  if (!documentObject?.body || !report) throw new Error('Prévia do informe indisponível.');
  const overlay = node(documentObject, 'div', { class: 'modal-overlay', 'data-informe-preview': '' });
  const section = node(documentObject, 'section', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Prévia do informe de atividade' });
  section.setAttribute('style', 'max-width:760px;max-height:94vh;overflow:auto;padding:20px');
  const title = node(documentObject, 'h3', {}, 'Prévia do informe do dia');
  const intro = node(documentObject, 'p', { style: 'font-size:.84rem;color:var(--muted);margin-bottom:10px' }, 'Revise a mensagem e as fotos. O compartilhamento abre o seletor do dispositivo; escolha o WhatsApp, o grupo e confirme o envio lá.');
  const warningBox = node(documentObject, 'div', { 'data-informe-warnings': '', role: 'status', style: 'display:none;background:#fff7ed;border:1px solid #fed7aa;border-radius:9px;padding:9px 12px;margin:10px 0;color:#9a3412;font-size:.8rem' });
  const warnings = [...(report.avisos || [])];
  if (fotosSemData) warnings.push(`${fotosSemData} lançamento(s) com fotos não têm uma data de referência confiável e foram excluídos do informe.`);
  if (warnings.length) {
    warningBox.style.display = '';
    const warningTitle = node(documentObject, 'strong', {}, 'Dados que precisam de atenção');
    warningBox.append(warningTitle);
    const list = node(documentObject, 'ul', { style: 'padding-left:20px;margin-top:5px' });
    warnings.forEach(message => list.append(node(documentObject, 'li', {}, message)));
    warningBox.append(list);
  }

  const textLabel = node(documentObject, 'label', { style: 'display:block;font-size:.82rem;font-weight:600;margin:12px 0 5px' }, 'Mensagem (editável)');
  const textarea = node(documentObject, 'textarea', { 'data-share-text': '', rows: '10', 'aria-label': 'Informe para compartilhar', style: 'width:100%;resize:vertical;white-space:pre-wrap' });
  textarea.value = report.message;
  const photoTitle = node(documentObject, 'h4', { style: 'font-size:.9rem;margin:14px 0 6px' }, `Fotos do dia · ${fotos.length} encontrada(s) · ${fotos.length - falhas.length} carregada(s) · ${falhas.length} falha(s)`);
  const photoHelp = node(documentObject, 'p', { style: 'font-size:.76rem;color:var(--muted);margin-bottom:8px' }, 'Cada lançamento aparece com Antes seguido de Depois. O WhatsApp/dispositivo controla a ordem final dos anexos e o posicionamento do texto.');
  const photoGrid = node(documentObject, 'div', { 'data-photo-grid': '', style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:8px' });
  const blobUrls = [];
  const failedIds = new Set(falhas.map(photo => photo.id));
  for (const photo of fotos) {
    const card = node(documentObject, 'figure', { style: 'margin:0;border:1px solid var(--border);border-radius:9px;padding:7px;min-width:0' });
    if (failedIds.has(photo.id) || !photo.file) {
      card.style.borderColor = '#fca5a5';
      card.style.background = '#fef2f2';
      card.append(node(documentObject, 'div', { role: 'img', 'aria-label': `Falha ao carregar ${photo.tipo}` , style: 'height:78px;display:grid;place-items:center;color:#b91c1c;font-size:1.5rem' }, '⚠️'));
      const reason = photo.error || 'Não foi possível carregar o arquivo da foto.';
      card.append(node(documentObject, 'figcaption', { style: 'font-size:.74rem;color:#991b1b;overflow-wrap:anywhere' }, `${photo.unidade} · ${photo.servico} · ${photo.tipo}. Falha: ${reason}`));
    } else {
      const imageUrl = URLClass.createObjectURL(photo.file);
      blobUrls.push(imageUrl);
      const image = node(documentObject, 'img', { src: imageUrl, alt: `${photo.unidade} · ${photo.servico} · ${photo.tipo}`, style: 'height:100px;width:100%;object-fit:cover;border-radius:6px;background:#f3f4f6' });
      card.append(image);
      card.append(node(documentObject, 'figcaption', { style: 'font-size:.74rem;margin-top:4px;overflow-wrap:anywhere' }, `${photo.unidade} · ${photo.servico} · ${photo.tipo}`));
    }
    photoGrid.append(card);
  }
  if (!fotos.length) photoGrid.append(node(documentObject, 'p', { style: 'grid-column:1/-1;color:var(--muted);font-size:.8rem' }, 'Nenhuma foto com data de referência igual à data selecionada.'));

  const status = node(documentObject, 'p', { 'data-status': '', role: 'status', style: 'font-size:.8rem;color:var(--muted);margin-top:8px;min-height:1.2em' });
  const buttons = node(documentObject, 'div', { class: 'modal-footer', style: 'display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;margin-top:14px' });
  const button = (key, label, css) => node(documentObject, 'button', { type: 'button', class: `btn ${css}`, [`data-${key}`]: '' }, label);
  const closeButton = button('close', 'Fechar', 'btn-outline');
  const copyButton = button('copy', 'Copiar mensagem', 'btn-outline');
  const whatsappButton = button('open-whatsapp', 'Abrir WhatsApp (somente texto)', 'btn-outline');
  const zipButton = button('download-photos', 'Baixar fotos organizadas (.zip)', 'btn-outline');
  const nativeButton = button('native-share', 'Compartilhar texto e fotos', 'btn-primary');
  buttons.append(closeButton, copyButton, whatsappButton, zipButton, nativeButton);
  section.append(title, intro, warningBox, textLabel, textarea, photoTitle, photoHelp, photoGrid, status, buttons);
  overlay.append(section);
  documentObject.body.append(overlay);

  const files = fotos.filter(photo => photo.file).map(photo => photo.file);
  let nativeFilesSupported = false;
  try { nativeFilesSupported = files.length > 0 && typeof navigatorObject?.share === 'function' && typeof navigatorObject?.canShare === 'function' && navigatorObject.canShare({ files }); }
  catch (_) { nativeFilesSupported = false; }
  nativeButton.hidden = !nativeFilesSupported;
  if (!nativeFilesSupported) {
    nativeButton.disabled = true;
    status.textContent = files.length ? 'Este dispositivo não aceita compartilhar fotos como arquivos pelo seletor nativo. Use o ZIP e anexe as fotos manualmente.' : 'O compartilhamento de arquivos não está disponível ou nenhuma foto carregou. Use as alternativas de texto e confira as falhas acima.';
  }
  zipButton.disabled = !zip || files.length === 0;
  zipButton.title = zipButton.disabled ? 'Não há fotos carregadas para baixar.' : 'Baixar um ZIP com as fotos carregadas, organizadas por lançamento.';

  const close = () => {
    for (const url of blobUrls) URLClass.revokeObjectURL(url);
    overlay.remove();
  };
  closeButton.addEventListener('click', close);
  copyButton.addEventListener('click', () => {
    const clipboard = navigatorObject?.clipboard;
    if (clipboard?.writeText) {
      clipboard.writeText(textarea.value).then(() => { status.textContent = 'Mensagem copiada. Nada foi enviado.'; }).catch(() => {
        textarea.focus(); textarea.select(); status.textContent = 'Não foi possível acessar a área de transferência. Selecione e copie a mensagem.';
      });
    } else {
      textarea.focus(); textarea.select(); status.textContent = 'Selecione e copie a mensagem.';
    }
  });
  whatsappButton.addEventListener('click', () => {
    const url = `https://wa.me/?text=${encodeURIComponent(textarea.value)}`;
    windowObject?.open?.(url, '_blank', 'noopener,noreferrer');
    status.textContent = 'WhatsApp aberto somente com o texto. Anexe as fotos baixadas e confirme o envio no WhatsApp.';
  });
  zipButton.addEventListener('click', () => {
    if (!zip) return;
    const href = URLClass.createObjectURL(zip);
    const link = node(documentObject, 'a', { href, download: nomeZip, style: 'display:none' });
    documentObject.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URLClass.revokeObjectURL(href), 1000);
    status.textContent = `${files.length} foto(s) baixadas em um ZIP organizado. ${falhas.length ? `Outras ${falhas.length} falha(s) estão identificadas acima.` : ''}`;
  });
  nativeButton.addEventListener('click', () => {
    if (!nativeFilesSupported) return;
    let pending;
    try {
      // A lista de File já está pronta. Chamar share sem awaits anteriores mantém a ativação do toque/clique.
      pending = navigatorObject.share({ text: textarea.value, files });
    } catch (error) {
      status.textContent = error?.message || 'O dispositivo não iniciou o seletor de compartilhamento.';
      return;
    }
    Promise.resolve(pending).then(() => {
      status.textContent = 'O seletor do dispositivo terminou. Confirme no WhatsApp se a mensagem e as fotos foram anexadas e conclua o envio lá.';
    }).catch(error => {
      if (error?.name === 'AbortError') status.textContent = 'Compartilhamento cancelado pelo usuário. Nada foi marcado como enviado.';
      else status.textContent = `Não foi possível compartilhar os arquivos: ${error?.message || 'erro desconhecido'}. Use o ZIP e anexe manualmente.`;
    });
  });
  return { element: overlay, close, textarea, nativeButton, zipButton, files };
}
