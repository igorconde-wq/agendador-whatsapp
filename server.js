const express = require('express');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const pino = require('pino');

const DEFAULT_PORT = process.env.PORT || 3000;
const FALLBACK_WA_VERSION = [2, 3000, 1015901307];

function parseMediaDataUrl(mediaUrl) {
  if (!mediaUrl || typeof mediaUrl !== 'string') return null;
  const match = mediaUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) return null;
  return {
    mimetype: match[1],
    buffer: Buffer.from(match[2].replace(/\s/g, ''), 'base64')
  };
}

function normalizeIsoDate(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function createDbHelpers(db) {
  const dbRun = (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.run(sql, params, function onRun(err) {
        if (err) return reject(err);
        resolve({ lastID: this.lastID, changes: this.changes });
      });
    });

  const dbAll = (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });

  const dbGet = (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      });
    });

  return { dbRun, dbAll, dbGet };
}

async function initDatabase(db, { dbRun }) {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_label TEXT,
      message TEXT NOT NULL,
      media_url TEXT,
      media_type TEXT,
      scheduled_at TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migrações seguras para bancos existentes criados por versões anteriores
  const extraColumns = [
    { name: 'target_label', definition: 'TEXT' },
    { name: 'error_message', definition: 'TEXT' }
  ];

  for (const col of extraColumns) {
    try {
      await dbRun(`ALTER TABLE schedules ADD COLUMN ${col.name} ${col.definition}`);
    } catch (err) {
      if (!/duplicate column name/i.test(err.message)) {
        throw err;
      }
    }
  }

  // Recupera agendamentos interrompidos caso o servidor tenha reiniciado no meio de um envio
  await dbRun(`UPDATE schedules SET status = 'pending' WHERE status = 'processing'`);
}

function createApp(options = {}) {
  const dataDir = options.dataDir || process.env.DATA_DIR || __dirname;
  if (dataDir !== ':memory:') {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = options.dbPath || (dataDir === ':memory:' ? ':memory:' : path.join(dataDir, 'schedules.db'));
  const authDir = options.authDir || path.join(dataDir, 'auth_info_baileys');
  const autoStartWhatsApp = options.autoStartWhatsApp !== false;
  const schedulerIntervalMs = options.schedulerIntervalMs ?? 15000;

  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));
  app.use(express.static(path.join(__dirname, 'public')));

  const db = new sqlite3.Database(dbPath);
  const { dbRun, dbAll, dbGet } = createDbHelpers(db);
  const dbReady = initDatabase(db, { dbRun }).catch((err) => {
    console.error('[DB] Erro ao inicializar banco de dados:', err);
    throw err;
  });

  // Estado do WhatsApp
  let sock = options.mockSock || null;
  let isConnected = Boolean(options.initialConnected);
  let userPhone = options.initialUserPhone || null;
  let connectionState = isConnected ? 'open' : 'connecting';
  let isInitializing = false;
  let reconnectTimer = null;
  let isProcessingSchedules = false;
  let schedulerTimer = null;
  let closed = false;

  function clearReconnectTimer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect(delayMs) {
    if (closed || !autoStartWhatsApp) return;
    clearReconnectTimer();
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      carregarBaileys();
    }, delayMs);
  }

  function cleanupSocket() {
    if (!sock) return;
    try {
      if (sock.ev && typeof sock.ev.removeAllListeners === 'function') {
        sock.ev.removeAllListeners('creds.update');
        sock.ev.removeAllListeners('connection.update');
      }
      if (typeof sock.end === 'function') {
        sock.end(new Error('Reinicializando conexão'));
      }
    } catch (_) {
      // Ignora erros ao encerrar socket antigo
    }
    sock = null;
  }

  function resetAuthFiles() {
    try {
      fs.rmSync(authDir, { recursive: true, force: true });
    } catch (err) {
      console.error('[WHATSAPP] Falha ao limpar credenciais antigas:', err.message);
    }
  }

  async function carregarBaileys() {
    if (closed || isInitializing || !autoStartWhatsApp) return;
    isInitializing = true;
    connectionState = 'connecting';
    clearReconnectTimer();

    try {
      const baileys = await import('@whiskeysockets/baileys');
      const makeWASocket = baileys.makeWASocket || baileys.default;
      const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = baileys;

      if (typeof makeWASocket !== 'function') {
        throw new Error('Função makeWASocket não encontrada no pacote @whiskeysockets/baileys.');
      }

      cleanupSocket();

      const { state, saveCreds } = await useMultiFileAuthState(authDir);
      const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: FALLBACK_WA_VERSION }));

      const currentSock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: Browsers && typeof Browsers.ubuntu === 'function'
          ? Browsers.ubuntu('Chrome')
          : ['Ubuntu', 'Chrome', '20.0.04']
      });

      sock = currentSock;

      currentSock.ev.on('creds.update', saveCreds);

      currentSock.ev.on('connection.update', (update) => {
        if (sock !== currentSock || closed) return;

        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
          isConnected = true;
          connectionState = 'open';
          userPhone = currentSock.user?.id ? currentSock.user.id.split(':')[0] : 'Conectado';
          console.log(`[WHATSAPP] ✅ Conectado com sucesso como: ${userPhone}`);
        } else if (connection === 'close') {
          isConnected = false;
          userPhone = null;
          connectionState = 'close';

          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const loggedOut = statusCode === DisconnectReason.loggedOut;

          if (loggedOut) {
            console.log('[WHATSAPP] Sessão encerrada (loggedOut). Limpando credenciais para permitir novo pareamento.');
            cleanupSocket();
            resetAuthFiles();
            scheduleReconnect(2000);
          } else {
            console.log(`[WHATSAPP] Conexão fechada (código: ${statusCode ?? 'desconhecido'}). Reconectando em 5s...`);
            scheduleReconnect(5000);
          }
        }
      });
    } catch (err) {
      console.error('[WHATSAPP] Aviso de inicialização:', err.message);
      connectionState = 'close';
      scheduleReconnect(8000);
    } finally {
      isInitializing = false;
    }
  }

  async function processPendingSchedules() {
    if (closed || isProcessingSchedules) return { processed: 0 };
    isProcessingSchedules = true;

    let processed = 0;
    try {
      await dbReady;
      const agora = new Date().toISOString();
      const rows = await dbAll(
        `SELECT * FROM schedules WHERE status = 'pending' AND scheduled_at <= ? ORDER BY scheduled_at ASC`,
        [agora]
      );

      if (rows.length === 0) return { processed: 0 };

      if (!isConnected || !sock || typeof sock.sendMessage !== 'function') {
        console.log(`[DISPARO] Aguardando conexão do WhatsApp (${rows.length} mensagem(ns) pendente(s))...`);
        return { processed: 0 };
      }

      for (const item of rows) {
        // Reivindica atomicamente o registro para evitar envios duplicados
        const claim = await dbRun(
          `UPDATE schedules SET status = 'processing' WHERE id = ? AND status = 'pending'`,
          [item.id]
        );
        if (claim.changes === 0) continue;

        try {
          let jid = item.target;
          if (item.target_type === 'individual') {
            const digits = String(item.target).replace(/\D/g, '');
            if (digits.length < 10) {
              throw new Error('Número de destino inválido.');
            }
            jid = `${digits}@s.whatsapp.net`;
          }

          if (item.media_url) {
            const parsedMedia = parseMediaDataUrl(item.media_url);
            if (!parsedMedia) {
              throw new Error('Formato de imagem inválido.');
            }
            await sock.sendMessage(jid, {
              image: parsedMedia.buffer,
              mimetype: parsedMedia.mimetype,
              caption: item.message || ''
            });
          } else {
            await sock.sendMessage(jid, { text: item.message });
          }

          await dbRun(`UPDATE schedules SET status = 'sent', error_message = NULL WHERE id = ?`, [item.id]);
          processed++;
          console.log(`[DISPARO] ✅ Mensagem #${item.id} enviada para ${item.target}!`);
        } catch (err) {
          console.error(`[DISPARO] ❌ Erro ao enviar #${item.id}:`, err.message);
          await dbRun(
            `UPDATE schedules SET status = 'failed', error_message = ? WHERE id = ?`,
            [err.message || 'Erro desconhecido ao enviar', item.id]
          );
        }
      }

      return { processed };
    } catch (err) {
      console.error('[DISPARO] Erro ao consultar agendamentos:', err.message);
      return { processed };
    } finally {
      isProcessingSchedules = false;
    }
  }

  // 1. Status
  app.get('/api/status', (req, res) => {
    res.json({
      connected: isConnected,
      phone: userPhone,
      state: connectionState
    });
  });

  // 2. Gerar Código de Pareamento de 8 dígitos
  app.post('/api/connect/pairing-code', async (req, res) => {
    try {
      const { phone } = req.body || {};
      if (!phone || typeof phone !== 'string') {
        return res.status(400).json({ error: 'Número de telefone é obrigatório.' });
      }

      const clean = phone.replace(/\D/g, '');
      if (clean.length < 10 || clean.length > 15) {
        return res.status(400).json({ error: 'Número inválido. Use DDI + DDD + Número (ex: 5511999998888).' });
      }

      if (isConnected) {
        return res.json({ success: true, alreadyConnected: true });
      }

      // Se houver credenciais antigas registradas mas desconectadas, reinicia limpo para permitir pareamento
      if (sock?.authState?.creds?.registered) {
        cleanupSocket();
        resetAuthFiles();
        await carregarBaileys();
      }

      if (!sock || typeof sock.requestPairingCode !== 'function') {
        return res.status(503).json({
          error: 'WhatsApp ainda está inicializando na nuvem. Aguarde alguns segundos e tente novamente.'
        });
      }

      const code = await sock.requestPairingCode(clean);
      console.log(`[WHATSAPP] Código de pareamento gerado para ${clean}`);
      res.json({ success: true, code });
    } catch (err) {
      console.error('[WHATSAPP] Erro ao gerar código de pareamento:', err);
      res.status(500).json({ error: 'Erro ao gerar código: ' + err.message });
    }
  });

  // 2b. Desconectar WhatsApp e limpar sessão
  app.post('/api/disconnect', async (req, res) => {
    try {
      if (sock && isConnected && typeof sock.logout === 'function') {
        await sock.logout().catch(() => {});
      }
      isConnected = false;
      userPhone = null;
      connectionState = 'close';
      cleanupSocket();
      resetAuthFiles();
      scheduleReconnect(1000);
      res.json({ success: true, message: 'WhatsApp desconectado com sucesso.' });
    } catch (err) {
      res.status(500).json({ error: 'Erro ao desconectar: ' + err.message });
    }
  });

  // 3. Grupos
  app.get('/api/groups', async (req, res) => {
    try {
      if (isConnected && sock && typeof sock.groupFetchAllParticipating === 'function') {
        const gruposObj = await sock.groupFetchAllParticipating();
        const grupos = Object.values(gruposObj || {})
          .map((g) => ({ id: g.id, name: g.subject || g.id }))
          .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
        return res.json(grupos);
      }
    } catch (err) {
      console.error('[WHATSAPP] Erro ao buscar grupos:', err.message);
    }
    res.json([]);
  });

  // 4. Listar Agendamentos
  app.get('/api/schedules', async (req, res) => {
    try {
      await dbReady;
      const rows = await dbAll('SELECT * FROM schedules ORDER BY scheduled_at ASC');
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 5. Criar Agendamento (Múltiplos horários)
  app.post('/api/schedules', async (req, res) => {
    try {
      await dbReady;
      const {
        target,
        target_type,
        target_label,
        message,
        media_url,
        media_type,
        scheduled_at,
        scheduled_at_list
      } = req.body || {};

      const tipo = target_type === 'grupo' ? 'grupo' : 'individual';
      const destino = typeof target === 'string' ? target.trim() : '';
      const texto = typeof message === 'string' ? message.trim() : '';

      let horariosBrutos = [];
      if (Array.isArray(scheduled_at_list) && scheduled_at_list.length > 0) {
        horariosBrutos = scheduled_at_list.filter((h) => typeof h === 'string' && h.trim() !== '');
      } else if (typeof scheduled_at === 'string' && scheduled_at.trim() !== '') {
        horariosBrutos = [scheduled_at.trim()];
      }

      if (!destino || (!texto && !media_url) || horariosBrutos.length === 0) {
        return res.status(400).json({ error: 'Destino, mensagem (ou imagem) e ao menos um horário são obrigatórios.' });
      }

      if (tipo === 'individual') {
        const digits = destino.replace(/\D/g, '');
        if (digits.length < 10 || digits.length > 15) {
          return res.status(400).json({ error: 'Número de contato inválido. Use DDI + DDD + Número (ex: 5511999998888).' });
        }
      } else if (!destino.endsWith('@g.us')) {
        return res.status(400).json({ error: 'Selecione um grupo válido do WhatsApp.' });
      }

      if (media_url && !parseMediaDataUrl(media_url)) {
        return res.status(400).json({ error: 'Anexo inválido. Envie apenas imagens em formato válido.' });
      }

      const horariosIso = [];
      for (const h of horariosBrutos) {
        const iso = normalizeIsoDate(h);
        if (!iso) {
          return res.status(400).json({ error: `Horário inválido: "${h}".` });
        }
        horariosIso.push(iso);
      }

      const tipoMidiaFinal = media_url ? (media_type && media_type !== 'none' ? media_type : 'image') : 'none';
      const rotuloDestino = typeof target_label === 'string' && target_label.trim() ? target_label.trim() : null;

      const sql = `
        INSERT INTO schedules (target, target_type, target_label, message, media_url, media_type, scheduled_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
      `;

      const ids = [];
      for (const horarioIso of horariosIso) {
        const result = await dbRun(sql, [
          destino,
          tipo,
          rotuloDestino,
          texto,
          media_url || null,
          tipoMidiaFinal,
          horarioIso
        ]);
        ids.push(result.lastID);
      }

      res.status(201).json({
        success: true,
        count: ids.length,
        ids,
        message: `${ids.length} envio(s) programado(s) com sucesso!`
      });
    } catch (err) {
      res.status(500).json({ error: 'Erro ao salvar agendamento: ' + err.message });
    }
  });

  // 6. Cancelar Agendamento
  app.delete('/api/schedules/:id', async (req, res) => {
    try {
      await dbReady;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'ID de agendamento inválido.' });
      }

      const result = await dbRun('DELETE FROM schedules WHERE id = ?', [id]);
      if (result.changes === 0) {
        return res.status(404).json({ error: 'Agendamento não encontrado.' });
      }

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Retornar JSON 404 para rotas de API inexistentes
  app.all('/api/*', (req, res) => {
    res.status(404).json({ error: 'Rota de API não encontrada.' });
  });

  // Tratamento de erros de JSON / payload
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Arquivo muito grande. O limite máximo é 50MB.' });
    }
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      return res.status(400).json({ error: 'JSON inválido na requisição.' });
    }
    return next(err);
  });

  // Servir frontend
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  if (autoStartWhatsApp) {
    carregarBaileys();
  }

  if (schedulerIntervalMs > 0) {
    schedulerTimer = setInterval(() => {
      processPendingSchedules();
    }, schedulerIntervalMs);
    if (typeof schedulerTimer.unref === 'function') {
      schedulerTimer.unref();
    }
  }

  async function close() {
    closed = true;
    clearReconnectTimer();
    if (schedulerTimer) {
      clearInterval(schedulerTimer);
      schedulerTimer = null;
    }
    cleanupSocket();
    await dbReady.catch(() => {});
    await new Promise((resolve) => db.close(() => resolve()));
  }

  return {
    app,
    db,
    dbReady,
    processPendingSchedules,
    close,
    setConnectionState(next) {
      if (typeof next.connected === 'boolean') isConnected = next.connected;
      if ('phone' in next) userPhone = next.phone;
      if ('sock' in next) sock = next.sock;
      if ('state' in next) connectionState = next.state;
    }
  };
}

if (require.main === module) {
  const instance = createApp();
  const server = instance.app.listen(DEFAULT_PORT, () => {
    console.log(`🚀 Servidor WhatsApp iniciado com sucesso na porta ${DEFAULT_PORT}`);
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('Encerrando servidor...');
    const forceExit = setTimeout(() => process.exit(0), 5000);
    if (typeof forceExit.unref === 'function') forceExit.unref();
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    server.close(async () => {
      await instance.close();
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = {
  createApp,
  parseMediaDataUrl,
  normalizeIsoDate
};
