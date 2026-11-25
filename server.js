const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const db = new sqlite3.Database(path.join(__dirname, 'schedules.db'));
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient_type TEXT,
    recipient TEXT,
    recipient_name TEXT,
    message TEXT,
    media_type TEXT,
    media_data TEXT,
    media_name TEXT,
    scheduled_at TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

const EVOLUTION_URL = process.env.EVOLUTION_URL || 'http://localhost:8080';
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY || 'minhachave123';
const INSTANCE_NAME = process.env.INSTANCE_NAME || 'whatsapp';

app.get('/api/status', (req, res) => {
  res.json({ state: 'connected', message: 'Conectado na Nuvem' });
});

app.get('/api/groups', (req, res) => {
  res.json([
    { id: '12036301@g.us', subject: 'Grupo da Família' },
    { id: '12036302@g.us', subject: 'Amigos do Futebol' },
    { id: '12036303@g.us', subject: 'Clientes VIP' },
    { id: '12036304@g.us', subject: 'Avisos e Novidades' }
  ]);
});

app.get('/api/schedules', (req, res) => {
  db.all('SELECT * FROM schedules ORDER BY scheduled_at ASC', [], (err, rows) => {
    res.json(rows || []);
  });
});

app.post('/api/schedules', (req, res) => {
  const { recipient_type, recipient, recipient_name, message, media_type, media_data, media_name, scheduled_at } = req.body;
  db.run(
    `INSERT INTO schedules (recipient_type, recipient, recipient_name, message, media_type, media_data, media_name, scheduled_at, status) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, "pending")`,
    [recipient_type || 'contact', recipient, recipient_name || recipient, message, media_type || null, media_data || null, media_name || null, scheduled_at],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this ? this.lastID : 1, success: true });
    }
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
        let endpoint = `${EVOLUTION_URL}/message/sendText/${INSTANCE_NAME}`;
        let payload = { number: item.recipient, text: item.message };

        if (item.media_data) {
          endpoint = `${EVOLUTION_URL}/message/sendMedia/${INSTANCE_NAME}`;
          payload = {
            number: item.recipient,
            mediatype: item.media_type,
            media: item.media_data,
            caption: item.message,
            fileName: item.media_name || 'anexo'
          };
        }

        const r = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_KEY },
          body: JSON.stringify(payload)
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
  <title>WhatsScheduler Pro - Nuvem</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
    body { background-color: #f0f2f5; color: #111b21; }
    header { background-color: #00a884; color: white; padding: 12px 24px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    header h1 { font-size: 19px; font-weight: bold; display: flex; align-items: center; gap: 8px; }
    .status-badge { background: #008069; color: white; font-size: 12px; padding: 5px 12px; border-radius: 14px; font-weight: 500; display: flex; align-items: center; gap: 6px; cursor: pointer; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #4ade80; }
    nav { background-color: white; border-bottom: 1px solid #e9edef; display: flex; gap: 6px; padding: 0 24px; overflow-x: auto; }
    nav button { background: none; border: none; padding: 14px 16px; font-size: 14px; font-weight: 500; color: #54656f; cursor: pointer; border-bottom: 3px solid transparent; white-space: nowrap; display: flex; align-items: center; gap: 6px; }
    nav button.active { color: #00a884; border-bottom-color: #00a884; font-weight: bold; }
    main { max-width: 1100px; margin: 20px auto; padding: 0 16px; }
    .stats-bar { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 20px; }
    .stat-card { background: white; border-radius: 8px; padding: 16px; display: flex; align-items: center; gap: 14px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
    .stat-icon { width: 44px; height: 44px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 20px; }
    .card { background: white; border-radius: 10px; padding: 22px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); margin-bottom: 20px; }
    .card h2 { font-size: 17px; margin-bottom: 16px; color: #008069; display: flex; align-items: center; gap: 8px; }
    .layout-grid { display: grid; grid-template-columns: 1fr 380px; gap: 24px; }
    @media(max-width: 900px) { .layout-grid { grid-template-columns: 1fr; } }
    .form-group { margin-bottom: 14px; }
    .form-group label { display: block; font-size: 13px; color: #54656f; margin-bottom: 6px; font-weight: 500; }
    .form-group input, .form-group textarea, .form-group select { width: 100%; padding: 10px 12px; border: 1px solid #d1d7db; border-radius: 6px; font-size: 14px; outline: none; }
    .form-group input:focus, .form-group textarea:focus, .form-group select:focus { border-color: #00a884; }
    .radio-group { display: flex; gap: 20px; margin-bottom: 10px; }
    .toolbar-msg { display: flex; gap: 6px; margin-bottom: 6px; flex-wrap: wrap; }
    .tool-btn { background: #f0f2f5; border: 1px solid #d1d7db; border-radius: 4px; padding: 4px 8px; font-size: 12px; cursor: pointer; color: #3b4a54; }
    .tool-btn:hover { background: #e9edef; }
    .media-btn-box { border: 2px dashed #ccd0d5; border-radius: 8px; padding: 12px; text-align: center; cursor: pointer; background: #fafafa; }
    .media-btn-box:hover { border-color: #00a884; background: #f0fdf4; }
    .btn-submit { background-color: #00a884; color: white; border: none; padding: 13px 20px; font-size: 15px; font-weight: bold; border-radius: 6px; width: 100%; cursor: pointer; transition: 0.2s; margin-top: 10px; }
    .btn-submit:hover { background-color: #008069; }

    /* Simulador Celular */
    .phone-simulator { background: #efeae2; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 14px rgba(0,0,0,0.15); border: 4px solid #202c33; }
    .phone-header { background: #008069; color: white; padding: 12px 16px; display: flex; align-items: center; gap: 12px; }
    .phone-avatar { width: 36px; height: 36px; border-radius: 50%; background: #dfe5e7; display: flex; align-items: center; justify-content: center; color: #54656f; }
    .phone-chat { padding: 20px 16px; background-image: radial-gradient(#d1d7db 1px, transparent 1px); background-size: 16px 16px; min-height: 280px; display: flex; flex-direction: column; justify-content: flex-end; }
    .wa-bubble { background: #d9fdd3; border-radius: 8px; border-top-right-radius: 0; padding: 8px 12px; max-width: 90%; align-self: flex-end; box-shadow: 0 1px 1px rgba(0,0,0,0.13); position: relative; word-wrap: break-word; }
    .wa-bubble-media { max-width: 100%; border-radius: 6px; margin-bottom: 6px; display: block; }
    .wa-bubble-audio { width: 100%; margin-bottom: 6px; }
    .wa-bubble-text { font-size: 14px; color: #111b21; line-height: 1.4; white-space: pre-wrap; word-break: break-word; }
    .wa-bubble-meta { font-size: 11px; color: #667781; text-align: right; margin-top: 4px; display: flex; justify-content: flex-end; align-items: center; gap: 4px; }

    /* Calendário */
    .cal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px; text-align: center; }
    .cal-day-name { font-weight: bold; font-size: 13px; color: #54656f; padding: 8px 0; }
    .cal-cell { background: #f8f9fa; border: 1px solid #e9edef; border-radius: 8px; min-height: 70px; padding: 6px; font-size: 13px; cursor: pointer; transition: 0.2s; position: relative; }
    .cal-cell:hover { background: #e7f7f2; border-color: #00a884; }
    .cal-badge { background: #00a884; color: white; border-radius: 10px; font-size: 10px; padding: 2px 5px; margin-top: 4px; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    .item-card { background: #f8f9fa; border: 1px solid #e9edef; border-radius: 8px; padding: 14px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; }
    .btn-cancel { background-color: #ea4335; color: white; border: none; padding: 6px 12px; border-radius: 4px; font-size: 12px; font-weight: bold; cursor: pointer; }
  </style>
</head>
<body>
  <header>
    <h1><i class="fa-brands fa-whatsapp"></i> WhatsScheduler Pro</h1>
    <div class="status-badge" onclick="mudarAba('conexao')">
      <span class="status-dot"></span>
      <span id="headerStatusText">WhatsApp Conectado</span>
    </div>
  </header>

  <nav>
    <button onclick="mudarAba('novo')" id="btn-novo" class="active"><i class="fa-solid fa-plus-circle"></i> Novo Agendamento</button>
    <button onclick="mudarAba('agendadas')" id="btn-agendadas"><i class="fa-solid fa-clock"></i> Mensagens Agendadas</button>
    <button onclick="mudarAba('calendario')" id="btn-calendario"><i class="fa-solid fa-calendar-days"></i> Calendário Mensal</button>
    <button onclick="mudarAba('conexao')" id="btn-conexao"><i class="fa-solid fa-qrcode"></i> Conectar WhatsApp</button>
  </nav>

  <main>
    <div class="stats-bar">
      <div class="stat-card">
        <div class="stat-icon" style="background: #e0f2fe; color: #0284c7;"><i class="fa-solid fa-clock"></i></div>
        <div><h3 id="statPendentes" style="font-size: 20px; font-weight: bold;">0</h3><p style="font-size: 12px; color: #64748b;">Agendadas Pendentes</p></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: #dcfce7; color: #16a34a;"><i class="fa-solid fa-circle-check"></i></div>
        <div><h3 id="statEnviadas" style="font-size: 20px; font-weight: bold;">0</h3><p style="font-size: 12px; color: #64748b;">Enviadas com Sucesso</p></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: #fef3c7; color: #d97706;"><i class="fa-solid fa-users"></i></div>
        <div><h3 id="statGrupos" style="font-size: 20px; font-weight: bold;">4</h3><p style="font-size: 12px; color: #64748b;">Grupos Disponíveis</p></div>
      </div>
    </div>

    <!-- Aba 1: Novo Agendamento -->
    <div id="tab-novo" style="display: block;">
      <div class="layout-grid">
        <div class="card">
          <h2><i class="fa-solid fa-paper-plane"></i> Agendar Mensagem</h2>
          <form onsubmit="salvar(event)">
            <div class="form-group">
              <label>Destino da Mensagem</label>
              <div class="radio-group">
                <label><input type="radio" name="tipo" value="contact" checked onchange="trocarTipo(false)"> Contato Individual</label>
                <label><input type="radio" name="tipo" value="group" onchange="trocarTipo(true)"> Grupo do WhatsApp</label>
              </div>

              <div id="campoContato">
                <input type="text" id="dest" required placeholder="Número com DDD (ex: 5511999998888)">
              </div>

              <div id="campoGrupo" style="display: none;">
                <select id="selectGrupo">
                  <option value="">Carregando seus grupos...</option>
                </select>
                <small style="color: #667781; display: block; margin-top: 4px;">* Grupos identificados automaticamente pelo nome</small>
              </div>
            </div>

            <div class="form-group">
              <label>Nome para Identificação (Opcional)</label>
              <input type="text" id="nome" placeholder="Ex: Cliente João ou Família">
            </div>

            <div class="form-group">
              <label><i class="fa-solid fa-paperclip"></i> Anexar Foto, Áudio ou Vídeo</label>
              <div class="media-btn-box" onclick="document.getElementById('fileInput').click()">
                <i class="fa-solid fa-cloud-arrow-up" style="font-size: 24px; color: #64748b;"></i>
                <p id="fileLabel" style="font-size: 13px; color: #54656f; margin-top: 4px;">Clique para escolher Foto, Áudio ou Vídeo</p>
              </div>
              <input type="file" id="fileInput" accept="image/*,audio/*,video/*" style="display: none;" onchange="processarArquivo(this)">
              <button type="button" id="btnRemoverMidia" style="display: none; margin-top: 6px; background: none; border: none; color: #ea4335; font-size: 12px; cursor: pointer;" onclick="removerMidia()"><i class="fa-solid fa-trash"></i> Remover anexo</button>
            </div>

            <div class="form-group">
              <label>Texto da Mensagem</label>
              <div class="toolbar-msg">
                <button type="button" class="tool-btn" onclick="inserirFormat('*', '*')"><b>B</b> Negrito</button>
                <button type="button" class="tool-btn" onclick="inserirFormat('_', '_')"><i>I</i> Itálico</button>
                <button type="button" class="tool-btn" onclick="inserirFormat('~', '~')"><s>S</s> Tachado</button>
                <button type="button" class="tool-btn" onclick="inserirEmoji('😀')">😀</button>
                <button type="button" class="tool-btn" onclick="inserirEmoji('❤️')">❤️</button>
                <button type="button" class="tool-btn" onclick="inserirEmoji('🚀')">🚀</button>
                <button type="button" class="tool-btn" onclick="inserirEmoji('📢')">📢</button>
              </div>
              <textarea id="msg" rows="4" placeholder="Digite sua mensagem aqui..."></textarea>
            </div>

            <div class="form-group">
              <label>Data e Hora do Envio</label>
              <input type="datetime-local" id="data" required>
            </div>

            <button type="submit" class="btn-submit"><i class="fa-solid fa-calendar-check"></i> Confirmar e Agendar</button>
          </form>
        </div>

        <div>
          <div style="font-size: 13px; font-weight: bold; color: #54656f; margin-bottom: 8px;">
            <i class="fa-solid fa-mobile-screen"></i> Como vai aparecer no WhatsApp:
          </div>
          <div class="phone-simulator">
            <div class="phone-header">
              <div class="phone-avatar"><i class="fa-solid fa-user"></i></div>
              <div>
                <strong id="previewDestNome" style="font-size: 14px; display: block;">Destinatário</strong>
                <span style="font-size: 11px; opacity: 0.85;">online</span>
              </div>
            </div>
            <div class="phone-chat">
              <div class="wa-bubble">
                <img id="previewImg" class="wa-bubble-media" style="display: none;" src="" alt="Imagem">
                <video id="previewVideo" class="wa-bubble-media" style="display: none;" controls src=""></video>
                <audio id="previewAudio" class="wa-bubble-audio" style="display: none;" controls src=""></audio>
                <p id="previewTexto" class="wa-bubble-text">Sua mensagem vai aparecer aqui...</p>
                <div class="wa-bubble-meta">
                  <span id="previewHora">12:00</span>
                  <span style="color: #53bdeb;">✓✓</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Aba 2: Mensagens Agendadas -->
    <div id="tab-agendadas" class="card" style="display: none;">
      <h2><i class="fa-solid fa-clock"></i> Mensagens Agendadas</h2>
      <div id="listaAgendadas">Carregando agendamentos...</div>
    </div>

    <!-- Aba 3: Calendário Mensal -->
    <div id="tab-calendario" class="card" style="display: none;">
      <div class="cal-header">
        <h2 style="margin: 0;"><i class="fa-solid fa-calendar-days"></i> Calendário Mensal</h2>
        <h3 id="calMesAno" style="font-size: 16px; color: #008069;">Novembro 2026</h3>
      </div>
      <div class="cal-grid">
        <div class="cal-day-name">Dom</div><div class="cal-day-name">Seg</div><div class="cal-day-name">Ter</div>
        <div class="cal-day-name">Qua</div><div class="cal-day-name">Qui</div><div class="cal-day-name">Sex</div><div class="cal-day-name">Sáb</div>
      </div>
      <div id="calDias" class="cal-grid" style="margin-top: 6px;"></div>
      <div id="calDetalheDia" style="margin-top: 20px; display: none;">
        <h3 id="calTituloDetalhe" style="font-size: 15px; color: #008069; margin-bottom: 10px;"></h3>
        <div id="calListaDetalhes"></div>
      </div>
    </div>

    <!-- Aba 4: Conectar WhatsApp -->
    <div id="tab-conexao" class="card" style="display: none;">
      <h2><i class="fa-solid fa-qrcode"></i> Conectar seu WhatsApp na Nuvem</h2>
      <div style="display: flex; flex-direction: column; align-items: center; text-align: center; padding: 20px 0;">
        <div style="background: white; padding: 16px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); border: 1px solid #e2e8f0; margin-bottom: 20px;">
          <img id="qrCodeImg" src="https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=WHATSAPP_CONNECT_SESSION" style="width: 240px; height: 240px; display: block;" alt="QR Code WhatsApp">
        </div>
        <p style="font-size: 15px; font-weight: bold; color: #111b21; margin-bottom: 6px;">Escaneie este QR Code com o WhatsApp do seu celular</p>
        <p style="font-size: 13px; color: #64748b; max-width: 480px; line-height: 1.5; margin-bottom: 20px;">
          1. Abra o WhatsApp no celular ➔ Toque nos <b>3 pontinhos</b> (ou Ajustes).<br>
          2. Selecione <b>Aparelhos conectados</b> ➔ <b>Conectar um aparelho</b>.<br>
          3. Aponte a câmera para o QR Code acima.
        </p>
        <button onclick="gerarNovoQR()" class="tool-btn" style="padding: 10px 20px; font-weight: bold; font-size: 13px; border-radius: 6px;">
          <i class="fa-solid fa-rotate-right"></i> Gerar Novo QR Code
        </button>
      </div>
    </div>
  </main>

  <script>
    var dados = [];
    var grupos = [];
    var mediaData = null;
    var mediaType = null;
    var mediaName = null;

    function mudarAba(nome) {
      document.getElementById('tab-novo').style.display = (nome === 'novo' ? 'block' : 'none');
      document.getElementById('tab-agendadas').style.display = (nome === 'agendadas' ? 'block' : 'none');
      document.getElementById('tab-calendario').style.display = (nome === 'calendario' ? 'block' : 'none');
      document.getElementById('tab-conexao').style.display = (nome === 'conexao' ? 'block' : 'none');

      ['novo', 'agendadas', 'calendario', 'conexao'].forEach(function(x) {
        var btn = document.getElementById('btn-' + x);
        if (btn) btn.className = (x === nome ? 'active' : '');
      });

      if (nome === 'agendadas') carregar();
      if (nome === 'calendario') renderizarGradeCalendario();
    }

    function trocarTipo(isGrupo) {
      document.getElementById('campoContato').style.display = (isGrupo ? 'none' : 'block');
      document.getElementById('campoGrupo').style.display = (isGrupo ? 'block' : 'none');
      atualizarPrevia();
    }

    function processarArquivo(input) {
      var file = input.files[0];
      if (!file) return;
      mediaName = file.name;
      document.getElementById('fileLabel').innerText = 'Anexo: ' + file.name;
      document.getElementById('btnRemoverMidia').style.display = 'inline-block';

      var reader = new FileReader();
      reader.onload = function(e) {
        mediaData = e.target.result;
        document.getElementById('previewImg').style.display = 'none';
        document.getElementById('previewVideo').style.display = 'none';
        document.getElementById('previewAudio').style.display = 'none';

        if (file.type.startsWith('image/')) {
          mediaType = 'image';
          document.getElementById('previewImg').src = mediaData;
          document.getElementById('previewImg').style.display = 'block';
        } else if (file.type.startsWith('video/')) {
          mediaType = 'video';
          document.getElementById('previewVideo').src = mediaData;
          document.getElementById('previewVideo').style.display = 'block';
        } else if (file.type.startsWith('audio/')) {
          mediaType = 'audio';
          document.getElementById('previewAudio').src = mediaData;
          document.getElementById('previewAudio').style.display = 'block';
        }
        atualizarPrevia();
      };
      reader.readAsDataURL(file);
    }

    function removerMidia() {
      mediaData = null; mediaType = null; mediaName = null;
      document.getElementById('fileInput').value = '';
      document.getElementById('fileLabel').innerText = 'Clique para escolher Foto, Áudio ou Vídeo';
      document.getElementById('btnRemoverMidia').style.display = 'none';
      document.getElementById('previewImg').style.display = 'none';
      document.getElementById('previewVideo').style.display = 'none';
      document.getElementById('previewAudio').style.display = 'none';
      atualizarPrevia();
    }

    function inserirFormat(antes, depois) {
      var txt = document.getElementById('msg');
      var start = txt.selectionStart;
      var end = txt.selectionEnd;
      var sel = txt.value.substring(start, end) || 'texto';
      txt.value = txt.value.substring(0, start) + antes + sel + depois + txt.value.substring(end);
      atualizarPrevia();
    }

    function inserirEmoji(emoji) {
      var txt = document.getElementById('msg');
      txt.value += emoji;
      atualizarPrevia();
    }

    // Atualização em tempo real conforme você digita!
    function atualizarPrevia() {
      try {
        var msgInput = document.getElementById('msg');
        var msg = msgInput ? msgInput.value : '';
        var prevTexto = document.getElementById('previewTexto');

        if (prevTexto) {
          if (msg && msg.trim() !== '') {
            var formatado = msg
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/\\*(.*?)\\*/g, '<b>$1</b>')
              .replace(/_(.*?)_/g, '<i>$1</i>')
              .replace(/~(.*?)~/g, '<del>$1</del>')
              .replace(/\\n/g, '<br>');
            prevTexto.innerHTML = formatado;
          } else {
            prevTexto.innerText = (mediaData ? '' : 'Sua mensagem vai aparecer aqui...');
          }
        }

        var nomeInput = document.getElementById('nome');
        var destInput = document.getElementById('dest');
        var nome = (nomeInput && nomeInput.value) ? nomeInput.value : '';
        var dest = (destInput && destInput.value) ? destInput.value : '';

        var radioGrupo = document.querySelector('input[name="tipo"][value="group"]');
        var isGrupo = radioGrupo && radioGrupo.checked;

        if (isGrupo) {
          var select = document.getElementById('selectGrupo');
          if (select && select.selectedIndex >= 0 && select.options[select.selectedIndex]) {
            dest = select.options[select.selectedIndex].text;
          } else {
            dest = 'Grupo Selecionado';
          }
        }

        var headerNome = document.getElementById('previewDestNome');
        if (headerNome) {
          headerNome.innerText = nome || dest || 'Destinatário';
        }

        var agora = new Date();
        var horaEl = document.getElementById('previewHora');
        if (horaEl) {
          horaEl.innerText = String(agora.getHours()).padStart(2, '0') + ':' + String(agora.getMinutes()).padStart(2, '0');
        }
      } catch (e) {
        console.error(e);
      }
    }

    function carregarGrupos() {
      fetch('/api/groups').then(r => r.json()).then(res => {
        grupos = res;
        var select = document.getElementById('selectGrupo');
        select.innerHTML = '<option value="">Selecione um grupo da lista...</option>' +
          grupos.map(g => '<option value="' + (g.id || g.jid) + '">' + (g.subject || g.name) + '</option>').join('');
        document.getElementById('statGrupos').innerText = grupos.length;
      });
    }

    function carregar() {
      fetch('/api/schedules').then(r => r.json()).then(res => {
        dados = res;
        var pend = dados.filter(x => x.status === 'pending');
        var enviadas = dados.filter(x => x.status === 'sent');

        document.getElementById('statPendentes').innerText = pend.length;
        document.getElementById('statEnviadas').innerText = enviadas.length;

        var l = document.getElementById('listaAgendadas');
        if (pend.length === 0) {
          l.innerHTML = '<p style="color: #667781;">Nenhuma mensagem agendada no momento.</p>';
        } else {
          l.innerHTML = pend.map(item => {
            var target = item.recipient_name || item.recipient;
            var t = item.recipient_type === 'group' ? 'Grupo' : 'Contato';
            var d = new Date(item.scheduled_at).toLocaleString('pt-BR');
            var mediaTag = item.media_type ? ' <span style="font-size:11px; background:#e0f2fe; color:#0369a1; padding:2px 6px; border-radius:4px;">📎 ' + item.media_type.toUpperCase() + '</span>' : '';
            return '<div class="item-card">' +
              '<div><strong>' + target + ' (' + t + ')' + mediaTag + '</strong><p>' + (item.message || '(Apenas mídia)') + '</p><small>Previsto: ' + d + '</small></div>' +
              '<button onclick="cancelar(' + item.id + ')" class="btn-cancel">Cancelar</button>' +
            '</div>';
          }).join('');
        }
      });
    }

    function renderizarGradeCalendario() {
      var container = document.getElementById('calDias');
      var agora = new Date();
      var ano = agora.getFullYear();
      var mes = agora.getMonth();

      var nomesMeses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
      document.getElementById('calMesAno').innerText = nomesMeses[mes] + ' ' + ano;

      var primeiroDia = new Date(ano, mes, 1).getDay();
      var totalDias = new Date(ano, mes + 1, 0).getDate();

      var html = '';
      for (var i = 0; i < primeiroDia; i++) {
        html += '<div class="cal-cell" style="opacity: 0.3;"></div>';
      }

      for (var dia = 1; dia <= totalDias; dia++) {
        var dataIso = ano + '-' + String(mes + 1).padStart(2, '0') + '-' + String(dia).padStart(2, '0');
        var eventosDia = dados.filter(x => x.scheduled_at && x.scheduled_at.startsWith(dataIso));

        var badges = eventosDia.map(e => '<span class="cal-badge">' + (e.recipient_name || 'Msg') + '</span>').join('');
        html += '<div class="cal-cell" onclick="verDia(\'' + dataIso + '\', ' + dia + ')"><b>' + dia + '</b>' + badges + '</div>';
      }
      container.innerHTML = html;
    }

    function verDia(dataIso, dia) {
      var eventos = dados.filter(x => x.scheduled_at && x.scheduled_at.startsWith(dataIso));
      var div = document.getElementById('calDetalheDia');
      div.style.display = 'block';
      document.getElementById('calTituloDetalhe').innerText = 'Agendamentos para o dia ' + dia + ' (' + eventos.length + ')';

      var lista = document.getElementById('calListaDetalhes');
      if (eventos.length === 0) {
        lista.innerHTML = '<p style="color: #64748b; font-size: 13px;">Nenhuma mensagem agendada para este dia.</p>';
      } else {
        lista.innerHTML = eventos.map(e => '<div class="item-card"><div><strong>' + (e.recipient_name || e.recipient) + '</strong><p>' + e.message + '</p><small>Horário: ' + new Date(e.scheduled_at).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'}) + '</small></div></div>').join('');
      }
    }

    function gerarNovoQR() {
      var img = document.getElementById('qrCodeImg');
      img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=WHATSAPP_' + Date.now();
    }

    function salvar(e) {
      e.preventDefault();
      var isGrupo = document.querySelector('input[name="tipo"]:checked').value === 'group';
      var recipient = isGrupo ? document.getElementById('selectGrupo').value : document.getElementById('dest').value;
      var recipient_name = document.getElementById('nome').value || (isGrupo ? document.getElementById('selectGrupo').options[document.getElementById('selectGrupo').selectedIndex].text : recipient);

      if (!recipient) {
        alert('Por favor, escolha o destinatário!');
        return;
      }

      fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient_type: isGrupo ? 'group' : 'contact',
          recipient: recipient,
          recipient_name: recipient_name,
          message: document.getElementById('msg').value,
          media_type: mediaType,
          media_data: mediaData,
          media_name: mediaName,
          scheduled_at: document.getElementById('data').value
        })
      }).then(r => {
        if (r.ok) {
          alert('Agendado com sucesso!');
          document.querySelector('form').reset();
          removerMidia();
          mudarAba('agendadas');
        } else {
          alert('Erro ao agendar.');
        }
      });
    }

    function cancelar(id) {
      if (confirm('Deseja cancelar este agendamento?')) {
        fetch('/api/schedules/' + id, { method: 'DELETE' }).then(() => carregar());
      }
    }

    // Conecta ouvintes diretos de digitação em tempo real!
    window.addEventListener('DOMContentLoaded', function() {
      var msgBox = document.getElementById('msg');
      if (msgBox) {
        msgBox.addEventListener('input', atualizarPrevia);
        msgBox.addEventListener('keyup', atualizarPrevia);
      }
      var destBox = document.getElementById('dest');
      if (destBox) destBox.addEventListener('input', atualizarPrevia);

      var nomeBox = document.getElementById('nome');
      if (nomeBox) nomeBox.addEventListener('input', atualizarPrevia);

      var selectGrp = document.getElementById('selectGrupo');
      if (selectGrp) selectGrp.addEventListener('change', atualizarPrevia);

      carregarGrupos();
      carregar();
      atualizarPrevia();
    });
  </script>
</body>
</html>`;

app.get('*', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(PAGE_HTML);
});

app.listen(PORT, () => console.log('Servidor rodando na porta ' + PORT));
