const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const pino = require('pino');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Banco SQLite
const db = new sqlite3.Database(path.join(__dirname, 'schedules.db'));
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target TEXT NOT NULL,
      target_type TEXT NOT NULL,
      message TEXT NOT NULL,
      media_url TEXT,
      media_type TEXT,
      scheduled_at TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// Estado do WhatsApp
let sock = null;
let isConnected = false;
let userPhone = null;

// Inicialização Segura com Importação Dinâmica
async function carregarBaileys() {
  try {
    const baileys = await import('@whiskeysockets/baileys');
    const makeWASocket = baileys.default || baileys.makeWASocket || baileys;
    const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = baileys;

    const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'auth_info_baileys'));
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));

    sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: ['Ubuntu', 'Chrome', '20.0.04']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update;
      if (connection === 'open') {
        isConnected = true;
        userPhone = sock.user?.id ? sock.user.id.split(':')[0] : 'Conectado';
        console.log(`[WHATSAPP] ✅ Conectado com sucesso como: ${userPhone}`);
      } else if (connection === 'close') {
        isConnected = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const deveReconectar = statusCode !== DisconnectReason.loggedOut;
        console.log(`[WHATSAPP] Conexão fechada. Reconectando: ${deveReconectar}`);
        if (deveReconectar) {
          setTimeout(carregarBaileys, 5000);
        }
      }
    });
  } catch (err) {
    console.error('[WHATSAPP] Aviso de inicialização:', err.message);
    setTimeout(carregarBaileys, 8000);
  }
}

// Inicia o WhatsApp em segundo plano
carregarBaileys();

// 1. Status
app.get('/api/status', (req, res) => {
  res.json({
    connected: isConnected,
    phone: userPhone
  });
});

// 2. Gerar Código de Pareamento de 8 dígitos
app.post('/api/connect/pairing-code', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Número de telefone é obrigatório.' });

    const clean = phone.replace(/\D/g, '');
    if (clean.length < 10) {
      return res.status(400).json({ error: 'Número inválido. Use 55 + DDD + Número.' });
    }

    if (isConnected) {
      return res.json({ success: true, alreadyConnected: true });
    }

    if (!sock || !sock.requestPairingCode) {
      return res.status(503).json({ error: 'WhatsApp ainda está inicializando na nuvem. Aguarde 10 segundos e tente de novo.' });
    }

    const code = await sock.requestPairingCode(clean);
    console.log(`[WHATSAPP] Código de pareamento: ${code}`);
    res.json({ success: true, code });
  } catch (err) {
    console.error('Erro ao gerar código:', err);
    res.status(500).json({ error: 'Erro ao gerar código: ' + err.message });
  }
});

// 3. Grupos
app.get('/api/groups', async (req, res) => {
  try {
    if (isConnected && sock && sock.groupFetchAllParticipating) {
      const gruposObj = await sock.groupFetchAllParticipating();
      const grupos = Object.values(gruposObj).map(g => ({ id: g.id, name: g.subject }));
      return res.json(grupos);
    }
  } catch (e) {}
  res.json([
    { id: '120363028392193821@g.us', name: '📢 Avisos e Comunicados (Exemplo)' },
    { id: '120363028392193822@g.us', name: '👥 Grupo Clientes VIP (Exemplo)' }
  ]);
});

// 4. Listar Agendamentos
app.get('/api/schedules', (req, res) => {
  db.all('SELECT * FROM schedules ORDER BY scheduled_at ASC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// 5. Criar Agendamento (Múltiplos horários)
app.post('/api/schedules', (req, res) => {
  const { target, target_type, message, media_url, media_type, scheduled_at, scheduled_at_list } = req.body;

  let horarios = [];
  if (Array.isArray(scheduled_at_list) && scheduled_at_list.length > 0) {
    horarios = scheduled_at_list.filter(h => h && h.trim() !== '');
  } else if (scheduled_at) {
    horarios = [scheduled_at];
  }

  if (!target || !message || horarios.length === 0) {
    return res.status(400).json({ error: 'Destino, mensagem e horário são obrigatórios.' });
  }

  const sql = `
    INSERT INTO schedules (target, target_type, message, media_url, media_type, scheduled_at, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `;

  let count = 0;
  db.serialize(() => {
    horarios.forEach(h => {
      db.run(sql, [target, target_type || 'individual', message, media_url || null, media_type || 'none', h], () => count++);
    });
  });

  setTimeout(() => {
    res.json({ success: true, count, message: `${count} envio(s) programado(s) com sucesso!` });
  }, 100);
});

// 6. Cancelar Agendamento
app.delete('/api/schedules/:id', (req, res) => {
  db.run('DELETE FROM schedules WHERE id = ?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// Loop automático de disparos a cada 15 segundos
setInterval(() => {
  const agora = new Date().toISOString();
  db.all(`SELECT * FROM schedules WHERE status = 'pending' AND scheduled_at <= ?`, [agora], async (err, rows) => {
    if (err || !rows || rows.length === 0) return;

    for (const item of rows) {
      if (!isConnected || !sock) {
        console.log(`[DISPARO] Aguardando conexão do WhatsApp para enviar #${item.id}...`);
        continue;
      }

      try {
        let jid = item.target;
        if (item.target_type === 'individual') {
          jid = item.target.replace(/\D/g, '') + '@s.whatsapp.net';
        }

        if (item.media_url && item.media_url.startsWith('data:image')) {
          const buffer = Buffer.from(item.media_url.split(',')[1], 'base64');
          await sock.sendMessage(jid, { image: buffer, caption: item.message });
        } else {
          await sock.sendMessage(jid, { text: item.message });
        }

        db.run(`UPDATE schedules SET status = 'sent' WHERE id = ?`, [item.id]);
        console.log(`[DISPARO] ✅ Mensagem #${item.id} enviada para ${item.target}!`);
      } catch (e) {
        console.error(`[DISPARO] ❌ Erro ao enviar #${item.id}:`, e.message);
        db.run(`UPDATE schedules SET status = 'failed' WHERE id = ?`, [item.id]);
      }
    }
  });
}, 15000);

// Servir frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar Servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor WhatsApp iniciado com sucesso na porta ${PORT}`);
});
