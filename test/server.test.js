const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const { createApp, parseMediaDataUrl, normalizeIsoDate } = require('../server');

function startTestServer(options = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agendador-wa-test-'));
  const instance = createApp({
    dataDir: tempDir,
    autoStartWhatsApp: false,
    schedulerIntervalMs: 0,
    ...options
  });

  return new Promise((resolve, reject) => {
    const server = http.createServer(instance.app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        instance,
        tempDir,
        async teardown() {
          await new Promise((r) => server.close(() => r()));
          await instance.close();
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      });
    });
    server.on('error', reject);
  });
}

test('helper parseMediaDataUrl e normalizeIsoDate', () => {
  const pngBase64 = 'data:image/png;base64,iVBORw0KGgo=';
  const parsed = parseMediaDataUrl(pngBase64);
  assert.ok(parsed);
  assert.equal(parsed.mimetype, 'image/png');
  assert.ok(Buffer.isBuffer(parsed.buffer));
  assert.equal(parseMediaDataUrl('data:text/plain;base64,abc='), null);
  assert.equal(parseMediaDataUrl('not-a-data-url'), null);

  assert.equal(normalizeIsoDate('2026-11-25T15:30:00.000Z'), '2026-11-25T15:30:00.000Z');
  assert.equal(normalizeIsoDate('2026-11-25T12:30:00-03:00'), '2026-11-25T15:30:00.000Z');
  assert.equal(normalizeIsoDate('data-invalida'), null);
});

test('API status, pairing-code, disconnect e groups', async () => {
  let logoutCalled = false;
  const mockSock = {
    requestPairingCode: async (phone) => `ABCD${phone.slice(-4)}`,
    groupFetchAllParticipating: async () => ({
      '2@g.us': { id: '2@g.us', subject: 'Zebra Grupo' },
      '1@g.us': { id: '1@g.us', subject: 'Alfa Grupo' }
    }),
    logout: async () => {
      logoutCalled = true;
    }
  };

  const ctx = await startTestServer({ mockSock });
  try {
    // Status inicial desconectado
    let res = await fetch(`${ctx.baseUrl}/api/status`);
    assert.equal(res.status, 200);
    let body = await res.json();
    assert.equal(body.connected, false);

    // Grupos quando desconectado deve ser array vazio (sem grupos falsos)
    res = await fetch(`${ctx.baseUrl}/api/groups`);
    assert.equal(res.status, 200);
    body = await res.json();
    assert.deepEqual(body, []);

    // Pairing code com telefone inválido
    res = await fetch(`${ctx.baseUrl}/api/connect/pairing-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '123' })
    });
    assert.equal(res.status, 400);

    // Pairing code válido
    res = await fetch(`${ctx.baseUrl}/api/connect/pairing-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '+55 (11) 99999-8888' })
    });
    assert.equal(res.status, 200);
    body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.code, 'ABCD8888');

    // Simula WhatsApp conectado e testa listagem ordenada de grupos
    ctx.instance.setConnectionState({ connected: true, phone: '5511999998888', sock: mockSock, state: 'open' });

    res = await fetch(`${ctx.baseUrl}/api/groups`);
    assert.equal(res.status, 200);
    body = await res.json();
    assert.deepEqual(body, [
      { id: '1@g.us', name: 'Alfa Grupo' },
      { id: '2@g.us', name: 'Zebra Grupo' }
    ]);

    // Disconnect
    res = await fetch(`${ctx.baseUrl}/api/disconnect`, { method: 'POST' });
    assert.equal(res.status, 200);
    assert.equal(logoutCalled, true);

    res = await fetch(`${ctx.baseUrl}/api/status`);
    body = await res.json();
    assert.equal(body.connected, false);
    assert.equal(body.phone, null);
  } finally {
    await ctx.teardown();
  }
});

test('CRUD de agendamentos, validação e normalização UTC', async () => {
  const ctx = await startTestServer();
  try {
    // Validações de erro
    let res = await fetch(`${ctx.baseUrl}/api/schedules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: '123', target_type: 'individual', message: 'Oi', scheduled_at: '2026-12-01T12:00:00Z' })
    });
    assert.equal(res.status, 400);

    res = await fetch(`${ctx.baseUrl}/api/schedules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'invalido', target_type: 'grupo', message: 'Oi', scheduled_at: '2026-12-01T12:00:00Z' })
    });
    assert.equal(res.status, 400);

    res = await fetch(`${ctx.baseUrl}/api/schedules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: '5511999998888', target_type: 'individual', message: 'Oi', scheduled_at: 'nao-e-data' })
    });
    assert.equal(res.status, 400);

    // Criação com múltiplos horários e imagem
    res = await fetch(`${ctx.baseUrl}/api/schedules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target: '5511999998888',
        target_type: 'individual',
        target_label: 'Cliente Teste',
        message: 'Olá!',
        media_url: 'data:image/png;base64,iVBORw0KGgo=',
        scheduled_at_list: ['2026-12-01T10:00:00-03:00', '2026-12-02T10:00:00-03:00']
      })
    });
    assert.equal(res.status, 201);
    const created = await res.json();
    assert.equal(created.count, 2);
    assert.equal(created.ids.length, 2);

    // Listagem
    res = await fetch(`${ctx.baseUrl}/api/schedules`);
    assert.equal(res.status, 200);
    const list = await res.json();
    assert.equal(list.length, 2);
    assert.equal(list[0].scheduled_at, '2026-12-01T13:00:00.000Z');
    assert.equal(list[0].media_type, 'image');
    assert.equal(list[0].target_label, 'Cliente Teste');

    // Exclusão inválida e 404
    res = await fetch(`${ctx.baseUrl}/api/schedules/abc`, { method: 'DELETE' });
    assert.equal(res.status, 400);

    res = await fetch(`${ctx.baseUrl}/api/schedules/99999`, { method: 'DELETE' });
    assert.equal(res.status, 404);

    // Exclusão válida
    res = await fetch(`${ctx.baseUrl}/api/schedules/${created.ids[0]}`, { method: 'DELETE' });
    assert.equal(res.status, 200);

    res = await fetch(`${ctx.baseUrl}/api/schedules`);
    const remaining = await res.json();
    assert.equal(remaining.length, 1);

    // Rota de API desconhecida retorna 404 JSON
    res = await fetch(`${ctx.baseUrl}/api/inexistente`);
    assert.equal(res.status, 404);
    const err404 = await res.json();
    assert.ok(err404.error);
  } finally {
    await ctx.teardown();
  }
});

test('Disparador processPendingSchedules evita duplicidade e trata texto, imagem e falha', async () => {
  const sentMessages = [];
  const mockSock = {
    sendMessage: async (jid, payload) => {
      await new Promise((r) => setTimeout(r, 30));
      if (jid.startsWith('5511000000000')) {
        throw new Error('Falha simulada de rede');
      }
      sentMessages.push({ jid, payload });
    }
  };

  const ctx = await startTestServer({
    mockSock,
    initialConnected: true,
    initialUserPhone: '5511999998888'
  });

  try {
    const pastIso = new Date(Date.now() - 60000).toISOString();
    const futureIso = new Date(Date.now() + 3600000).toISOString();

    // 1. Mensagem de texto vencida
    await fetch(`${ctx.baseUrl}/api/schedules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target: '5511988887777',
        target_type: 'individual',
        message: 'Texto devido',
        scheduled_at: pastIso
      })
    });

    // 2. Mensagem com imagem para grupo vencida
    await fetch(`${ctx.baseUrl}/api/schedules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target: '120363028392193821@g.us',
        target_type: 'grupo',
        message: 'Legenda da foto',
        media_url: 'data:image/jpeg;base64,/9j/4AAQ',
        scheduled_at: pastIso
      })
    });

    // 3. Mensagem que deve falhar
    await fetch(`${ctx.baseUrl}/api/schedules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target: '5511000000000',
        target_type: 'individual',
        message: 'Vai falhar',
        scheduled_at: pastIso
      })
    });

    // 4. Mensagem futura (não deve ser enviada)
    await fetch(`${ctx.baseUrl}/api/schedules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target: '5511977776666',
        target_type: 'individual',
        message: 'Mensagem futura',
        scheduled_at: futureIso
      })
    });

    // Chama concorrentemente para garantir que não haja envio duplicado
    await Promise.all([
      ctx.instance.processPendingSchedules(),
      ctx.instance.processPendingSchedules()
    ]);

    assert.equal(sentMessages.length, 2);
    assert.equal(sentMessages[0].jid, '5511988887777@s.whatsapp.net');
    assert.deepEqual(sentMessages[0].payload, { text: 'Texto devido' });

    assert.equal(sentMessages[1].jid, '120363028392193821@g.us');
    assert.equal(sentMessages[1].payload.mimetype, 'image/jpeg');
    assert.equal(sentMessages[1].payload.caption, 'Legenda da foto');
    assert.ok(Buffer.isBuffer(sentMessages[1].payload.image));

    const res = await fetch(`${ctx.baseUrl}/api/schedules`);
    const rows = await res.json();
    const byMsg = Object.fromEntries(rows.map((r) => [r.message, r]));

    assert.equal(byMsg['Texto devido'].status, 'sent');
    assert.equal(byMsg['Legenda da foto'].status, 'sent');
    assert.equal(byMsg['Vai falhar'].status, 'failed');
    assert.match(byMsg['Vai falhar'].error_message, /Falha simulada/);
    assert.equal(byMsg['Mensagem futura'].status, 'pending');
  } finally {
    await ctx.teardown();
  }
});

test('Frontend index.html possui JS sintaticamente válido e todas as funções de eventos definidas', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(scriptMatch, 'Bloco <script> não encontrado em public/index.html');

  const scriptCode = scriptMatch[1];
  // Valida sintaxe JS sem executar
  assert.doesNotThrow(() => new Function(scriptCode));

  // Garante que todos os handlers referenciados no HTML existem no script
  const expectedFunctions = [
    'trocarAba',
    'atualizarTipoDestino',
    'atualizarPreviaNome',
    'atualizarPreviaHora',
    'carregarGrupos',
    'tratarArquivo',
    'removerMidia',
    'adicionarOutroHorario',
    'salvarAgendamento',
    'carregarAgendamentos',
    'cancelar',
    'mudarMes',
    'renderizarCalendario',
    'mostrarDetalhesDia',
    'gerarCodigoPareamento',
    'desconectarWhatsApp',
    'copiarCodigo',
    'verificarStatus',
    'escapeHtml'
  ];

  for (const fn of expectedFunctions) {
    const regex = new RegExp(`(async\\s+)?function\\s+${fn}\\s*\\(`);
    assert.match(scriptCode, regex, `Função ${fn} não encontrada no script de public/index.html`);
  }
});
