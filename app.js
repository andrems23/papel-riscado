// Pequeno atalho para selecionar elementos do DOM.
const $ = selector => document.querySelector(selector);
const views = document.querySelectorAll('.view');
let selectedImage = null;
let records = [];
let db;
let editingId = null;

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
  editingId = null;
  selectedImage = await compressImage(file);
  openForm();
  detectText(file);
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
  $('#date').value = now.toISOString().slice(0, 10);
  $('#time').value = now.toTimeString().slice(0, 5);
  if (selectedImage) $('#receiptImage').src = selectedImage;
  else $('#receiptImage').removeAttribute('src');
  $('#noImage').hidden = Boolean(selectedImage);
  go('formView');
}

// Tenta ler os dados do recibo automaticamente por OCR.
async function detectText(file) {
  const status = $('#extracting');
  status.classList.remove('hidden');
  try {
    let text = '';
    // Usa o OCR nativo quando o navegador o disponibiliza.
    if ('TextDetector' in window) {
      const bitmap = await createImageBitmap(file);
      const blocks = await new TextDetector().detect(bitmap);
      text = blocks.map(block => block.rawValue).join('\n');
    }
    // Tesseract é a alternativa de OCR em português.
    if (!text && window.Tesseract) {
      const result = await Tesseract.recognize(file, 'por', {
        logger: message => {
          if (message.status === 'recognizing text') {
            status.lastChild.textContent = ` Lendo recibo… ${Math.round(message.progress * 100)}%`;
          }
        },
      });
      text = result.data.text;
    }
    if (!text.trim()) throw new Error('OCR sem texto');
    parseReceipt(text);
    toast('Campos encontrados — confira antes de salvar');
  } catch {
    toast('Não foi possível ler automaticamente. Confira e preencha os campos.');
  } finally {
    status.classList.add('hidden');
  }
}

// Extrai valor, data, hora e nome do estabelecimento do texto lido.
function parseReceipt(text) {
  const lines = text.split(/\n+/).map(line => line.trim()).filter(Boolean);
  const money = [...text.matchAll(/(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+\.\d{2})/g)]
    .map(match => match[1]);
  // Em geral, o último valor do cupom é o total pago.
  if (money.length) $('#amount').value = money[money.length - 1];
  const date = text.match(/(\d{2})[/-](\d{2})[/-](\d{2,4})/);
  if (date) {
    const year = date[3].length === 2 ? `20${date[3]}` : date[3];
    $('#date').value = `${year}-${date[2]}-${date[1]}`;
  }
  const time = text.match(/\b([01]\d|2[0-3]):([0-5]\d)(?::\d{2})?\b/);
  if (time) $('#time').value = `${time[1]}:${time[2]}`;
  const merchant = lines.find(line => (
    /[A-Za-zÀ-ÿ]{3}/.test(line) && !/(cnpj|cpf|data|total|valor|cliente)/i.test(line)
  ));
  if (merchant) $('#merchant').value = merchant;
  const categories = [
    ['posto', 'Posto de gasolina'], ['combust', 'Posto de gasolina'],
    ['restaur', 'Restaurante'], ['lanchon', 'Restaurante'],
    ['mercado', 'Mercado'], ['supermerc', 'Mercado'],
    ['farm', 'Farmácia'], ['hotel', 'Hospedagem'],
  ];
  const category = categories.find(([term]) => text.toLowerCase().includes(term));
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
  if (!amount) {
    toast('Informe um valor válido');
    return;
  }
  const receipt = {
    id: editingId || crypto.randomUUID(), amount, merchant: $('#merchant').value.trim(),
    category: $('#category').value, date: $('#date').value, time: $('#time').value,
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

const icons = { Restaurante: '☕', 'Posto de gasolina': '⛽', Mercado: '🛒', Transporte: '◌', Farmácia: '✚', Hospedagem: '⌂', Outros: '◈' };
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
        element.querySelector('.receipt-meta').textContent = `${receipt.category} · ${formatDate(receipt.date, receipt.time)}`;
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
  $('#category').value = receipt.category;
  $('#date').value = receipt.date;
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
  const rows = [['Valor', 'Estabelecimento', 'Categoria', 'Data', 'Hora', 'Observação'], ...records.map(receipt => [
    receipt.amount.toFixed(2).replace('.', ','), receipt.merchant, receipt.category,
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
