const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

// Limite elevado para suportar imagens e mídias em Base64
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Servir os arquivos estáticos da pasta public (onde está o index.html)
app.use(express.static(path.join(__dirname, 'public')));

// Inicializar banco SQLite persistente
const db = new sqlite3.Database(path.join(__dirname, 'schedules.db'), (err) => {
  if (err) console.error('Erro ao conectar ao SQLite:', err.message);
  else console.log('Banco de dados SQLite pronto.');
});

// Criar tabela se não existir
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

// Rotas da API
// 1. Status do serviço
app.get('/api/status', (req, res) => {
  res.json({
    connected: true,
    status: 'online',
    timestamp: new Date().toISOString()
  });
});

// 2. Lista de grupos do WhatsApp
app.get('/api/groups', (req, res) => {
  res.json([
    { id: '120363028392193821@g.us', name: '📢 Avisos e Comunicados' },
    { id: '120363028392193822@g.us', name: '👥 Grupo Clientes VIP' },
    { id: '120363028392193823@g.us', name: '💼 Equipe e Suporte' }
  ]);
});

// 3. Listar agendamentos
app.get('/api/schedules', (req, res) => {
  db.all('SELECT * FROM schedules ORDER BY scheduled_at ASC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// 4. Salvar agendamento (suporta múltiplos horários para a mesma mensagem)
app.post('/api/schedules', (req, res) => {
  const { target, target_type, message, media_url, media_type, scheduled_at, scheduled_at_list } = req.body;

  if (!target || !message) {
    return res.status(400).json({ error: 'Destinatário e mensagem são obrigatórios.' });
  }

  let horarios = [];
  if (Array.isArray(scheduled_at_list) && scheduled_at_list.length > 0) {
    horarios = scheduled_at_list.filter(h => h && h.trim() !== '');
  } else if (scheduled_at) {
    horarios = [scheduled_at];
  }

  if (horarios.length === 0) {
    return res.status(400).json({ error: 'Informe ao menos um horário para envio.' });
  }

  const sql = `
    INSERT INTO schedules (target, target_type, message, media_url, media_type, scheduled_at, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `;

  let concluidos = 0;
  let erro = null;

  db.serialize(() => {
    horarios.forEach((horario) => {
      db.run(sql, [target, target_type || 'individual', message, media_url || null, media_type || 'none', horario], function(err) {
        if (err) erro = err;
        else concluidos++;
      });
    });
  });

  setTimeout(() => {
    if (erro && concluidos === 0) {
      return res.status(500).json({ error: erro.message });
    }
    res.json({
      success: true,
      count: concluidos,
      message: `${concluidos} agendamento(s) salvo(s) com sucesso!`
    });
  }, 120);
});

// 5. Excluir / Cancelar agendamento
app.delete('/api/schedules/:id', (req, res) => {
  db.run('DELETE FROM schedules WHERE id = ?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, removed: this.changes });
  });
});

// Loop automático de envio (executa a cada 15 segundos em segundo plano)
setInterval(() => {
  const agora = new Date().toISOString();
  db.all(
    `SELECT * FROM schedules WHERE status = 'pending' AND scheduled_at <= ?`,
    [agora],
    (err, rows) => {
      if (err || !rows || rows.length === 0) return;

      rows.forEach((agendamento) => {
        console.log(`[DISPARO] Enviando agendamento #${agendamento.id} para ${agendamento.target}...`);
        // Marca como enviado
        db.run(`UPDATE schedules SET status = 'sent' WHERE id = ?`, [agendamento.id]);
      });
    }
  );
}, 15000);

// Qualquer outra rota entrega o index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor WhatsApp iniciado com sucesso na porta ${PORT}`);
});
