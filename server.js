const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const db = new sqlite3.Database(path.join(__dirname, 'schedules.db'));
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient_type TEXT,
    recipient TEXT,
    recipient_name TEXT,
    message TEXT,
    scheduled_at TEXT,
    status TEXT DEFAULT 'pending'
  )`);
});

const EVOLUTION_URL = process.env.EVOLUTION_URL || 'http://localhost:8080';
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY || 'chave123';
const INSTANCE_NAME = process.env.INSTANCE_NAME || 'whatsapp';

app.get('/api/schedules', (req, res) => {
  db.all('SELECT * FROM schedules ORDER BY scheduled_at ASC', [], (err, rows) => {
    res.json(rows || []);
  });
});

app.post('/api/schedules', (req, res) => {
  const { recipient_type, recipient, recipient_name, message, scheduled_at } = req.body;
  db.run(
    'INSERT INTO schedules (recipient_type, recipient, recipient_name, message, scheduled_at, status) VALUES (?, ?, ?, ?, ?, "pending")',
    [recipient_type || 'contact', recipient, recipient_name || recipient, message, scheduled_at],
    function(err) { res.json({ id: this ? this.lastID : 1, success: true }); }
  );
});

app.delete('/api/schedules/:id', (req, res) => {
  db.run('DELETE FROM schedules WHERE id = ?', [req.params.id], () => res.json({ success: true }));
});

cron.schedule('*/20 * * * * *', () => {
  const now = new Date().toISOString().slice(0, 16);
  db.all('SELECT * FROM schedules WHERE status = "pending" AND scheduled_at <= ?', [now], async (err, rows) => {
    if (!rows) return;
    for (const item of rows) {
      try {
        const r = await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_NAME}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_KEY },
          body: JSON.stringify({ number: item.recipient, text: item.message })
        });
        db.run('UPDATE schedules SET status = ? WHERE id = ?', [r.ok ? 'sent' : 'failed', item.id]);
      } catch (e) {
        db.run('UPDATE schedules SET status = "failed" WHERE id = ?', [item.id]);
      }
    }
  });
});

const PAGE_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WhatsScheduler Nuvem</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
    body { background-color: #f0f2f5; color: #111b21; }
    header { background-color: #00a884; color: white; padding: 16px 24px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    header h1 { font-size: 20px; font-weight: bold; }
    .status-badge { background: #008069; color: white; font-size: 12px; padding: 4px 12px; border-radius: 12px; font-weight: 500; }
    nav { background-color: white; border-bottom: 1px solid #e9edef; display: flex; gap: 8px; padding: 0 24px; }
    nav button { background: none; border: none; padding: 14px 16px; font-size: 14px; font-weight: 500; color: #54656f; cursor: pointer; border-bottom: 3px solid transparent; }
    nav button.active { color: #00a884; border-bottom-color: #00a884; font-weight: bold; }
    main { max-width: 800px; margin: 24px auto; padding: 0 16px; }
    .card { background: white; border-radius: 10px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); margin-bottom: 20px; }
    .card h2 { font-size: 18px; margin-bottom: 16px; color: #008069; }
    .form-group { margin-bottom: 16px; }
    .form-group label { display: block; font-size: 13px; color: #54656f; margin-bottom: 6px; font-weight: 500; }
    .form-group input, .form-group textarea { width: 100%; padding: 10px 12px; border: 1px solid #d1d7db; border-radius: 6px; font-size: 14px; outline: none; }
    .form-group input:focus, .form-group textarea:focus { border-color: #00a884; }
    .radio-group { display: flex; gap: 20px; margin-bottom: 10px; }
    .btn-submit { background-color: #00a884; color: white; border: none; padding: 12px 20px; font-size: 15px; font-weight: bold; border-radius: 6px; width: 100%; cursor: pointer; transition: 0.2s; }
    .btn-submit:hover { background-color: #008069; }
    .item-card { background: #f8f9fa; border: 1px solid #e9edef; border-radius: 8px; padding: 14px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; }
    .item-info strong { font-size: 15px; color: #111b21; }
    .item-info p { font-size: 13px; color: #3b4a54; margin: 4px 0; }
    .item-info small { font-size: 12px; color: #667781; }
    .btn-cancel { background-color: #ea4335; color: white; border: none; padding: 6px 12px; border-radius: 4px; font-size: 12px; font-weight: bold; cursor: pointer; }
    .btn-cancel:hover { background-color: #d33426; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <header>
    <h1>WhatsScheduler Nuvem</h1>
    <span class="status-badge">● Sistema Ativo 24h</span>
  </header>

  <nav>
    <button onclick="tab('novo')" id="btn-novo" class="active">Novo Agendamento</button>
    <button onclick="tab('agendadas')" id="btn-agendadas">Mensagens Agendadas</button>
    <button onclick="tab('calendario')" id="btn-calendario">Calendário</button>
  </nav>

  <main>
    <!-- Aba Novo -->
    <div id="tab-novo" class="card">
      <h2>Agendar Nova Mensagem</h2>
      <form onsubmit="salvar(event)">
        <div class="form-group">
          <label>Destino da Mensagem</label>
          <div class="radio-group">
            <label><input type="radio" name="tipo" value="contact" checked onchange="trocarTipo(false)"> Contato Individual</label>
            <label><input type="radio" name="tipo" value="group" onchange="trocarTipo(true)"> Grupo do WhatsApp</label>
          </div>
          <input type="text" id="dest" required placeholder="Número com DDD (ex: 5511999998888)">
          <small id="dicaGrupo" style="color: #667781; display: none; margin-top: 4px;">Informe o ID do grupo (terminado em @g.us)</small>
        </div>

        <div class="form-group">
          <label>Nome para Identificação (Opcional)</label>
          <input type="text" id="nome" placeholder="Ex: Grupo da Família ou Cliente João">
        </div>

        <div class="form-group">
          <label>Mensagem</label>
          <textarea id="msg" required rows="3" placeholder="Digite o texto da mensagem que será enviada..."></textarea>
        </div>

        <div class="form-group">
          <label>Data e Hora do Envio</label>
          <input type="datetime-local" id="data" required>
        </div>

        <button type="submit" class="btn-submit">Confirmar e Agendar</button>
      </form>
    </div>

    <!-- Aba Agendadas -->
    <div id="tab-agendadas" class="card hidden">
      <h2>Mensagens Agendadas (Pendentes)</h2>
      <div id="listaAgendadas">Carregando agendamentos...</div>
    </div>

    <!-- Aba Calendário -->
    <div id="tab-calendario" class="card hidden">
      <h2>Calendário de Mensagens</h2>
      <div id="listaCalendario">Carregando eventos...</div>
    </div>
  </main>

  <script>
    var dados = [];
    function tab(nome) {
      ['novo', 'agendadas', 'calendario'].forEach(function(x) {
        document.getElementById('tab-' + x).classList.toggle('hidden', x !== nome);
        document.getElementById('btn-' + x).className = (x === nome ? 'active' : '');
      });
      if (nome !== 'novo') carregar();
    }
    function trocarTipo(isGrupo) {
      document.getElementById('dest').placeholder = isGrupo ? 'ID do Grupo (ex: 1203630@g.us)' : 'Número com DDD (ex: 5511999998888)';
      document.getElementById('dicaGrupo').style.display = isGrupo ? 'block' : 'none';
    }
    function carregar() {
      fetch('/api/schedules').then(function(r){ return r.json(); }).then(function(res) {
        dados = res;
        var pend = dados.filter(function(x){ return x.status === 'pending'; });
        var l = document.getElementById('listaAgendadas');
        if (pend.length === 0) {
          l.innerHTML = '<p style="color: #667781;">Nenhuma mensagem agendada no momento.</p>';
        } else {
          l.innerHTML = pend.map(function(item) {
            var target = item.recipient_name || item.recipient;
            var t = item.recipient_type === 'group' ? 'Grupo' : 'Contato';
            var d = new Date(item.scheduled_at).toLocaleString('pt-BR');
            return '<div class="item-card">' +
              '<div class="item-info">' +
                '<strong>' + target + ' (' + t + ')</strong>' +
                '<p>' + item.message + '</p>' +
                '<small>Previsto para: ' + d + '</small>' +
              '</div>' +
              '<button onclick="cancelar(' + item.id + ')" class="btn-cancel">Cancelar</button>' +
            '</div>';
          }).join('');
        }

        var c = document.getElementById('listaCalendario');
        if (dados.length === 0) {
          c.innerHTML = '<p style="color: #667781;">Nenhum evento registrado.</p>';
        } else {
          c.innerHTML = dados.map(function(item) {
            var st = item.status === 'sent' ? 'Enviada' : (item.status === 'pending' ? 'Agendada' : 'Cancelada');
            var cor = item.status === 'sent' ? '#00a884' : (item.status === 'pending' ? '#f59e0b' : '#ea4335');
            var d = new Date(item.scheduled_at).toLocaleString('pt-BR');
            var target = item.recipient_name || item.recipient;
            var t = item.recipient_type === 'group' ? 'Grupo' : 'Contato';
            return '<div class="item-card">' +
              '<div class="item-info">' +
                '<strong><span style="color:' + cor + ';">● ' + st + '</span> — ' + target + ' (' + t + ')</strong>' +
                '<p><strong>Mensagem:</strong> ' + item.message + '</p>' +
                '<small>Data: ' + d + '</small>' +
              '</div>' +
            '</div>';
          }).join('');
        }
      });
    }
    function salvar(e) {
      e.preventDefault();
      fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient_type: document.querySelector('input[name="tipo"]:checked').value,
          recipient: document.getElementById('dest').value,
          recipient_name: document.getElementById('nome').value,
          message: document.getElementById('msg').value,
          scheduled_at: document.getElementById('data').value
        })
      }).then(function(r) {
        if (r.ok) {
          alert('Mensagem agendada com sucesso!');
          document.querySelector('form').reset();
          tab('agendadas');
        } else {
          alert('Erro ao agendar.');
        }
      });
    }
    function cancelar(id) {
      if (confirm('Tem certeza que deseja cancelar este agendamento?')) {
        fetch('/api/schedules/' + id, { method: 'DELETE' }).then(function() { carregar(); });
      }
    }
  </script>
</body>
</html>`;

app.get('*', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(PAGE_HTML);
});

app.listen(PORT, () => console.log('Servidor rodando na porta ' + PORT));
