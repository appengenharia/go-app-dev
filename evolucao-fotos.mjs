const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function validarDataReferencia(value) {
  if (typeof value !== 'string') return '';
  const match = ISO_DATE.exec(value);
  if (!match) return '';
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return date.getUTCFullYear() === Number(y)
    && date.getUTCMonth() === Number(m) - 1
    && date.getUTCDate() === Number(d) ? value : '';
}

export function dataReferenciaRegistro(registro) {
  return validarDataReferencia(registro?.dataReferencia)
    || validarDataReferencia(registro?.data)
    || '';
}

export function formatarDataReferencia(value, vazio = 'Data não informada') {
  const iso = validarDataReferencia(value);
  if (!iso) return vazio;
  const [, year, month, day] = ISO_DATE.exec(iso);
  return `${day}/${month}/${year}`;
}

export function hojeLocalISO(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export function dataCorteLocal(days, now = new Date()) {
  const count = Math.max(0, Number(days) || 0);
  if (!count) return '';
  const cutoff = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - count));
  return [cutoff.getUTCFullYear(), String(cutoff.getUTCMonth() + 1).padStart(2, '0'), String(cutoff.getUTCDate()).padStart(2, '0')].join('-');
}
