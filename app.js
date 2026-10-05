// Pequeno atalho para selecionar elementos do DOM.
const $ = selector => document.querySelector(selector);
const views = document.querySelectorAll('.view');
let selectedImage = null;
let records = [];
let db;
let editingId = null;
let ocrRunId = 0;

// Alterna tema e salva.
function setTheme(theme) {
  document.body.classList.toggle('dark-theme', theme === 'dark');
  $('#themeBtn').textContent = theme === 'dark' ? '☀' : '◐';
  $('#themeBtn').setAttribute('aria-label', theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro');
  localStorage.setItem('concilia-theme', theme);
}

const savedTheme = localStorage.getItem('concilia-theme');
setTheme(savedTheme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
$('#themeBtn').onclick = () => setTheme(document.body.classList.contains('dark-theme') ? 'light' : 'dark');

// Abre o banco local.
const dbRequest = indexedDB.open('concilia-db', 1);
dbRequest.onupgradeneeded = event => {
  event.target.result.createObjectStore('receipts', { keyPath: 'id' });
};
dbRequest.onsuccess = event => {
  db = event.target.result;
  loadRecords();
};

// Troca a tela ativa do app conforme o botão selecionado.
function go(viewId) {
  if (viewId !== 'formView') ocrRunId++;
  views.forEach(view => view.classList.toggle('active', view.id === viewId));
  document.querySelectorAll('[data-go]').forEach(button => {
    button.classList.toggle('selected', button.dataset.go === viewId);
  });
}

document.querySelectorAll('[data-go]').forEach(button => {
  button.onclick = () => go(button.dataset.go);
});
$('.scan-button').onclick = () => go('captureView');
$('.back-button').onclick = event => go(event.currentTarget.dataset.go);
$('#manualBtn').onclick = () => {
  editingId = null;
  selectedImage = null;
  openForm();
};
$('#galleryInput').onchange = event => handleFile(event.target.files[0]);
$('#cameraInput').onchange = event => handleFile(event.target.files[0]);
$('#date').addEventListener('input', event => {
  const input = event.currentTarget;
  const digitsBeforeCursor = input.value.slice(0, input.selectionStart).replace(/\D/g, '').length;
  const digits = input.value.replace(/\D/g, '').slice(0, 8);
  const formatted = digits
    .replace(/^(\d{2})(\d)/, '$1/$2')
    .replace(/^(\d{2}\/\d{2})(\d)/, '$1/$2');
  input.value = formatted;
  const cursor = digitsBeforeCursor + (digitsBeforeCursor > 2 ? 1 : 0) + (digitsBeforeCursor > 4 ? 1 : 0);
  input.setSelectionRange(cursor, cursor);
});
$('#closeDialog').onclick = () => $('#imageDialog').close();
$('#previewButton').onclick = () => {
  if (!selectedImage) return;
  $('#dialogImage').src = selectedImage;
  $('#imageDialog').showModal();
};
$('#deletePhotoBtn').onclick = () => {
  selectedImage = null;
  $('#receiptImage').removeAttribute('src');
  $('#noImage').hidden = false;
  toast('Foto removida');
};

// Recebe a imagem e a prepara para o formulário e OCR.
async function handleFile(file) {
  if (!file) return;
  const runId = ++ocrRunId;
  editingId = null;
  selectedImage = await compressImage(file);
  if (runId !== ocrRunId) return;
  openForm();
  detectText(file, runId);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Reduz a imagem para economizar espaço e manter o app mais leve.
async function compressImage(file) {
  try {
    const source = URL.createObjectURL(file);
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = reject;
      element.src = source;
    });
    const maxSize = 1600;
    const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(source);
    // Reduz a foto antes de ocupar o armazenamento local.
    return canvas.toDataURL('image/jpeg', 0.82);
  } catch {
    return readFileAsDataUrl(file);
  }
}

// Preenche os campos do formulário com a data e hora atuais.
function openForm() {
$('#receiptForm').reset();
  $('#deleteReceiptBtn').classList.toggle('hidden',!editingId);
  const now = new Date();
  $('#date').value = formatDateInput(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);
  $('#time').value = now.toTimeString().slice(0, 5);
  if (selectedImage) $('#receiptImage').src = selectedImage;
  else $('#receiptImage').removeAttribute('src');
  $('#noImage').hidden = Boolean(selectedImage);
  go('formView');
}

// Tenta ler os dados do recibo automaticamente por OCR.
async function prepareOCRImage(file) {
  const source = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = reject;
      element.src = source;
    });
    const scale = Math.min(1.5, 2400 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const gray = 0.299 * pixels.data[i] + 0.587 * pixels.data[i + 1] + 0.114 * pixels.data[i + 2];
      const contrasted = Math.max(0, Math.min(255, (gray - 128) * 1.25 + 128));
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = contrasted;
    }
    context.putImageData(pixels, 0, 0);
    return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Falha ao preparar imagem')), 'image/png'));
  } finally {
    URL.revokeObjectURL(source);
  }
}

async function detectText(file, runId) {
  const status = $('#extracting');
  const statusText = $('#ocr-status');
  statusText.textContent = 'Lendo informações do recibo…';
  status.classList.remove('hidden');
  try {
    let text = '';
    // Tesseract é o mecanismo principal para manter a leitura em português previsível.
    if (!text && window.Tesseract) {
      const preparedImage = await prepareOCRImage(file);
      const result = await Tesseract.recognize(preparedImage, 'por', {
        logger: message => {
          if (runId === ocrRunId && message.status === 'recognizing text')
            statusText.textContent = `Lendo recibo… ${Math.round(message.progress * 100)}%`;
        },
      });
      text = result.data.text;
    }
    // TextDetector fica como alternativa caso o script externo não esteja disponível.
    if (!text && 'TextDetector' in window) {
      const bitmap = await createImageBitmap(file);
      try {
        const blocks = await new TextDetector().detect(bitmap);
        text = blocks.map(block => block.rawValue).join('\n');
      } finally {
        bitmap.close();
      }
    }
    if (runId !== ocrRunId) return;
    if (!text.trim()) throw new Error('OCR sem texto');
    parseReceipt(text);
    toast('Campos encontrados — confira antes de salvar');
  } catch {
    if (runId !== ocrRunId) return;
    toast('Não foi possível ler automaticamente. Confira e preencha os campos.');
  } finally {
    if (runId === ocrRunId) status.classList.add('hidden');
  }
}

function normalizeCategory(category) {
  const normalized = String(category || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (['saude', 'farmacia', 'hospital', 'cuidados pessoais'].includes(normalized)) return 'Saúde';
  if (['alimentacao', 'restaurante', 'mercado', 'padaria'].includes(normalized)) return 'Alimentação';
  if (['transporte', 'posto de gasolina', 'estacionamento'].includes(normalized)) return 'Transporte';
  if (['contas de consumo', 'despesas da casa'].includes(normalized)) return 'Contas de consumo';
  if (['prestadores de servico', 'hospedagem', 'manutencao do veiculo'].includes(normalized)) return 'Prestadores de serviço';
  return 'Outros';
}

function parseDateValue(value) {
  const input = String(value || '').trim();
  let year; let month; let day;
  const iso = input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const brazilian = input.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (iso) [, year, month, day] = iso;
  else if (brazilian) [, day, month, year] = brazilian;
  else return '';
  if (year.length === 2) year = `20${year}`;
  const y = Number(year); const m = Number(month); const d = Number(day);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() !== m - 1 || parsed.getUTCDate() !== d) return '';
  return `${year.padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function formatDateInput(isoDate) {
  const match = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

// Extrai valor, data, hora e nome do estabelecimento do texto lido.
function parseReceipt(text) {
  const lines = text.split(/\n+/).map(line => line.trim()).filter(Boolean);
  const money = [...text.matchAll(/(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+\.\d{2})/g)]
    .map(match => match[1]);
  const moneyPattern = '(?:R\\$\\s*)?([0-9]{1,3}(?:\\.[0-9]{3})*,[0-9]{2}|[0-9]+\\.[0-9]{2})';
  const totalLine = lines.find(line => /\b(total|valor\s+a\s+pagar|total\s+a\s+pagar)\b/i.test(line));
  const totalMatch = totalLine?.match(new RegExp(`(?:total|valor\\s+a\\s+pagar|total\\s+a\\s+pagar)\\s*:?\\s*${moneyPattern}`, 'i'))
    || totalLine?.match(new RegExp(`${moneyPattern}\\s*(?:total|valor\\s+a\\s+pagar|total\\s+a\\s+pagar)`, 'i'));
  // Prefere o valor junto ao rótulo de total; se não existir, usa um fallback sem troco.
  const fallbackMoney = [...text.matchAll(new RegExp(moneyPattern, 'g'))]
    .filter(match => !/\btroco\b/i.test(text.slice(Math.max(0, match.index - 24), match.index)));
  if (totalMatch) $('#amount').value = totalMatch[1];
  else if (fallbackMoney.length) $('#amount').value = fallbackMoney[fallbackMoney.length - 1][1];
  else if (money.length) $('#amount').value = money[money.length - 1];
  const dateCandidates = [...text.matchAll(/\b(\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/g)];
  for (const candidate of dateCandidates) {
    const isoDate = parseDateValue(candidate[1]);
    if (isoDate) {
      $('#date').value = formatDateInput(isoDate);
      break;
    }
  }
  const timePattern = /\b([01]?\d|2[0-3]):([0-5]\d)(?::\d{2})?\b/;
  const linesWithTime = text.split(/\n+/).filter(line => timePattern.test(line));
  const timeAndDateLine = [...linesWithTime].reverse().find(line => /\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(line));
  const explicitTimeLine = linesWithTime.find(line => /\b(hora|horario|emissao|emissão|data\s*\/\s*hora)\b/i.test(line));
  const timeLine = timeAndDateLine || explicitTimeLine || linesWithTime.at(-1) || '';
  const lineTimes = [...timeLine.matchAll(new RegExp(timePattern.source, 'g'))];
  const time = lineTimes.at(-1);
  if (time) $('#time').value = `${time[1].padStart(2, '0')}:${time[2]}`;
  const normalizeText = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const normalizedText = normalizeText(text);
  if (/\b(debito)\b/i.test(normalizedText)) $('#paymentMethod').value = 'Débito';
  else if (/\b(credito)\b/i.test(normalizedText)) $('#paymentMethod').value = 'Crédito';
  else if (/\b(transferencia|pix)\b/i.test(normalizedText)) $('#paymentMethod').value = 'Transferência';
  else if (/\b(dinheiro|especie)\b/i.test(normalizedText)) $('#paymentMethod').value = 'Dinheiro';
  const excludedMerchantLine = /\b(cnpj|cpf|cnf|data|hora|total|subtotal|valor|cliente|consumidor|documento|auxiliar|nota fiscal|chave|protocolo|inscricao|ie|danfe|cupom fiscal|sat|nfc-e|nfce|endereco|rua|avenida|av\.?|bairro|cep|telefone|fone|pagamento|tributos|impostos|consulta|operador|caixa|pedido|item|quantidade|desconto|troco)\b/i;
  const merchant = lines
    .map((line, index) => {
      const candidateLine = line
        .replace(/\b(cnpj|cpf)\b\s*:?\s*[\d./-]+/ig, ' ')
        .replace(/\b(ie|inscricao estadual)\b\s*:?\s*[\d./-]+/ig, ' ')
        .replace(/^[\d./-]{4,}\s+/, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      const normalized = normalizeText(candidateLine);
      let score = 0;
      if (/[A-Za-zÀ-ÿ]{3}/.test(candidateLine)) score += 1;
      if (/\b(ltda|eireli|perfumaria|mercado|supermercado|restaurante|padaria|posto|drogaria|farmacia|hotel|loja|comercio|auto pecas)\b/i.test(normalized)) score += 5;
      if (/\d/.test(candidateLine)) score -= 2;
      if (candidateLine.length < 4 || candidateLine.length > 64) score -= 3;
      if (excludedMerchantLine.test(normalized)) score -= 10;
      if (/^[\d\s./:-]+$/.test(candidateLine)) score -= 10;
      if (/\b(ltda|eireli|perfumaria|comercio|mercado|supermercado|restaurante|padaria|posto|drogaria|farmacia|hotel|loja)\b/i.test(normalized)) score += 2;
      return { line: candidateLine, index, score };
    })
    .filter(candidate => candidate.score >= 3)
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.line;
  if (merchant) $('#merchant').value = merchant;
  const categories = [
    [/\b(enel|sabesp|comgas|cpfl|equatorial|cemig|copel)\b|\b(conta|fatura)\s+(?:de\s+)?(energia|eletricidade|luz|agua|gas|internet|telefone)\b/, 'Contas de consumo'],
    [/\b(posto|combustivel|gasolina|etanol|diesel|uber|estacionamento)\b/, 'Transporte'],
    [/\b(restaurante|lanchonete|padaria|acougue|mercado|supermercado)\b/, 'Alimentação'],
    [/\b(drogaria|farmacia|hospital|clinica)\b/, 'Saúde'],
    [/\b(oficina|auto pecas|hotel)\b/, 'Prestadores de serviço'],
  ];
  const category = categories.find(([pattern]) => pattern.test(normalizedText));
  if (category) $('#category').value = category[1];
}

function normalizeAmount(value) {
  const cleaned = value.replace(/[^\d,.]/g, '');
  if (cleaned.includes(',')) {
    return Number(cleaned.replace(/\./g, '').replace(',', '.'));
  }

  // Aceita tanto 12,34 quanto 12.34 retornado pelo OCR.
  const decimalPoint = cleaned.match(/\.(\d{2})$/);
  if (decimalPoint) {
    const integer = cleaned.slice(0, -3).replace(/\./g, '');
    return Number(`${integer}.${decimalPoint[1]}`);
  }
  return Number(cleaned.replace(/\./g, ''));
}

// Salva ou atualiza o lançamento no banco local do dispositivo.
$('#receiptForm').onsubmit = event => {
  event.preventDefault();
  const amount = normalizeAmount($('#amount').value);
  const date = parseDateValue($('#date').value);
  if (!Number.isFinite(amount) || amount <= 0) {
    toast('Informe um valor válido');
    return;
  }
  if (!date) {
    toast('Informe uma data válida no formato DD/MM/AAAA');
    return;
  }
  const receipt = {
    id: editingId || crypto.randomUUID(), amount, merchant: $('#merchant').value.trim(),
    category: $('#category').value, paymentMethod: $('#paymentMethod').value, date, time: $('#time').value,
    note: $('#note').value.trim(), image: selectedImage, createdAt: Date.now(),
  };
  const transaction = db.transaction('receipts', 'readwrite');
  transaction.objectStore('receipts').put(receipt);
  transaction.oncomplete = () => {
    const recordIndex = records.findIndex(record => record.id === receipt.id);
    if (recordIndex >= 0) records[recordIndex] = receipt;
    else records.unshift(receipt);
    records.sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
    editingId = null;
    render();
    go('homeView');
    toast(recordIndex >= 0 ? 'Lançamento atualizado' : 'Lançamento salvo no dispositivo');
  };
};

// Recupera os lançamentos salvos para renderizar a tela inicial.
function loadRecords() {
  const transaction = db.transaction('receipts');
  const request = transaction.objectStore('receipts').getAll();
  request.onsuccess = () => {
    records = request.result.sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
    render();
  };
}

const icons = { Saúde: '✚', Alimentação: '☕', Transporte: '↔', 'Contas de consumo': '▤', 'Prestadores de serviço': '⌂', Outros: '◈' };
function brl(value) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value); }
function formatDate(date, time) { return `${new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR')} · ${time}`; }

// Monta a lista de despesas agrupadas por mês e ano.
function render() {
  const list = $('#receiptList');
  const empty = $('#emptyState');
  const total = records.reduce((sum, receipt) => sum + receipt.amount, 0);

  list.innerHTML = '';
  empty.hidden = records.length > 0;
  $('#monthTotal').textContent = brl(total);

  if (!records.length) return;

  const groups = new Map();
  records.forEach(receipt => {
    const monthKey = receipt.date.slice(0, 7);
    if (!groups.has(monthKey)) groups.set(monthKey, []);
    groups.get(monthKey).push(receipt);
  });

  const orderedMonths = [...groups.keys()].sort((a, b) => b.localeCompare(a));

  orderedMonths.forEach(monthKey => {
    const group = document.createElement('section');
    group.className = 'month-group';

    const header = document.createElement('h3');
    header.className = 'month-header';
    header.textContent = new Date(`${monthKey}-01T12:00:00`).toLocaleDateString('pt-BR', {
      month: 'long',
      year: 'numeric',
    });

    group.appendChild(header);

    groups.get(monthKey)
      .sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time))
      .forEach(receipt => {
        const element = document.createElement('article');
        element.className = 'receipt';
        element.innerHTML = `<div class="receipt-icon">${icons[receipt.category] || '◈'}</div><div class="receipt-main"><div class="receipt-name"></div><div class="receipt-meta"></div></div><div class="receipt-value">${brl(receipt.amount)}</div>`;
        element.querySelector('.receipt-name').textContent = receipt.merchant;
        element.querySelector('.receipt-meta').textContent = `${receipt.category} · ${receipt.paymentMethod || 'Forma de pagamento não informada'} · ${formatDate(receipt.date, receipt.time)}`;
        element.onclick = () => showRecord(receipt);
        group.appendChild(element);
      });

    list.appendChild(group);
  });
}

function showRecord(receipt) {
  editingId = receipt.id;
  selectedImage = receipt.image;
  openForm();
  $('#amount').value = receipt.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  $('#merchant').value = receipt.merchant;
  $('#category').value = normalizeCategory(receipt.category);
  $('#paymentMethod').value = receipt.paymentMethod || '';
  $('#date').value = formatDateInput(receipt.date);
  $('#time').value = receipt.time;
  $('#note').value = receipt.note;
  toast('Edite os dados e salve as alterações');
}

// Exporta os dados em CSV para uso em planilhas ou conferência.
function exportCSV() {
  if (!records.length) {
    toast('Não há lançamentos para exportar');
    return;
  }
  // Aspas e ponto e vírgula preservam acentos e vírgulas no Excel.
  const escapeValue = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = [['Valor', 'Estabelecimento', 'Categoria', 'Forma de pagamento', 'Data', 'Hora', 'Observação'], ...records.map(receipt => [
    receipt.amount.toFixed(2).replace('.', ','), receipt.merchant, normalizeCategory(receipt.category), receipt.paymentMethod || '',
    new Date(`${receipt.date}T12:00`).toLocaleDateString('pt-BR'), receipt.time, receipt.note,
  ])];
  const csv = rows.map(row => row.map(escapeValue).join(';')).join('\r\n');
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `conciliacao-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  toast('Planilha CSV baixada');
}

$('#deleteReceiptBtn').onclick = () => {
  if (!editingId || !confirm('Apagar esta nota emitida? Esta ação não pode ser desfeita.')) return;
  const id = editingId;
  const transaction = db.transaction('receipts', 'readwrite');
  transaction.objectStore('receipts').delete(id);
  transaction.oncomplete = () => {
    records = records.filter(receipt => receipt.id !== id);
    editingId = null;
    selectedImage = null;
    render();
    go('homeView');
    toast('Nota apagada');
  };
};$('#exportBtn').onclick = exportCSV;
$('#navExport').onclick = exportCSV;
// Exibe mensagem curta informando ações do usuário.
function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => element.classList.remove('show'), 2800);
}

// Mantém os arquivos do app disponíveis após a primeira abertura.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
