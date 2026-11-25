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

// Suporte a múltiplos horários em um único agendamento!
app.post('/api/schedules', (req, res) => {
  const { recipient_type, recipient, recipient_name, message, media_type, media_data, media_name, scheduled_at, scheduled_at_list } = req.body;
  const datas = (Array.isArray(scheduled_at_list) && scheduled_at_list.length > 0) ? scheduled_at_list : [scheduled_at];

  const stmt = db.prepare(
    `INSERT INTO schedules (recipient_type, recipient, recipient_name, message, media_type, media_data, media_name, scheduled_at, status) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, "pending")`
  );

  datas.forEach(d => {
    if (d) {
      stmt.run([recipient_type || 'contact', recipient, recipient_name || recipient, message, media_type || null, media_data || null, media_name || null, d]);
    }
  });

  stmt.finalize(err => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, count: datas.length });
  });
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
    header { background-color: #00a884; color: white; padding: 14px 24px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    header h1 { font-size: 19px; font-weight: bold; display: flex; align-items: center; gap: 8px; }
    .status-badge { background: #008069; color: white; font-size: 12px; padding: 5px 12px; border-radius: 14px; font-weight: 500; display: flex; align-items: center; gap: 6px; cursor: pointer; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #4ade80; }
    nav { background-color: white; border-bottom: 1px solid #e9edef; display: flex; gap: 6px; padding: 0 24px; overflow-x: auto; }
    nav button { background: none; border: none; padding: 14px 16px; font-size: 14px; font-weight: 500; color: #54656f; cursor: pointer; border-bottom: 3px solid transparent; white-space: nowrap; display: flex; align-items: center; gap: 6px; }
    nav button.active { color: #00a884; border-bottom-color: #00a884; font-weight: bold; }
    main { max-width: 1100px; margin: 20px auto; padding: 0 16px; }
    .card { background: white; border-radius: 10px; padding: 22px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); margin-bottom: 20px; }
    .card h2 { font-size: 17px; margin-bottom: 16px; color: #008069; display: flex; align-items: center; gap: 8px; }
    .layout-grid { display: grid; grid-template-columns: 1fr 380px; gap: 24px; align-items: start; }
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

    /* Simulador Celular Sticky */
    .phone-simulator { background: #efeae2; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 14px rgba(0,0,0,0.15); border: 4px solid #202c33; position: sticky; top: 20px; }
    .phone-header { background: #008069; color: white; padding: 12px 16px; display: flex; align-items: center; gap: 12px; }
    .phone-avatar { width: 36px; height: 36px; border-radius: 50%; background: #dfe5e7; display: flex; align-items: center; justify-content: center; color: #54656f; }
    .phone-chat { padding: 20px 16px; background-image: radial-gradient(#d1d7db 1px, transparent 1px); background-size: 16px 16px; min-height: 280px; display: flex; flex-direction: column; justify-content: flex-end; }
    .wa-bubble { background: #d9fdd3; border-radius: 8px; border-top-right-radius: 0; padding: 8px 12px; max-width: 90%; align-self: flex-end; box-shadow: 0 1px 1px rgba(0,0,0,0.13); position: relative; word-wrap: break-word; }
    .wa-bubble-media { max-width: 100%; border-radius: 6px; margin-bottom: 6px; display: none; }
    .wa-bubble-text { font-size: 14px; color: #111b21; line-height: 1.4; white-space: pre-wrap; word-break: break-word; min-height: 20px; }
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
    <div class="status-badge" onclick="abrirAba('conexao')">
      <span class="status-dot"></span>
      <span id="headerStatusText">WhatsApp Conectado</span>
    </div>
  </header>

  <nav>
    <button type="button" class="nav-btn active" id="btn-novo" onclick="abrirAba('novo')"><i class="fa-solid fa-plus-circle"></i> Novo Agendamento</button>
    <button type="button" class="nav-btn" id="btn-agendadas" onclick="abrirAba('agendadas'); carregar();"><i class="fa-solid fa-clock"></i> Mensagens Agendadas</button>
    <button type="button" class="nav-btn" id="btn-calendario" onclick="abrirAba('calendario'); renderizarGradeCalendario();"><i class="fa-solid fa-calendar-days"></i> Calendário Mensal</button>
    <button type="button" class="nav-btn" id="btn-conexao" onclick="abrirAba('conexao')"><i class="fa-solid fa-qrcode"></i> Conectar WhatsApp</button>
  </nav>

  <main>
    <!-- Aba 1: Novo Agendamento -->
    <div id="aba-novo" class="aba-item" style="display: block;">
      <div class="layout-grid">
        <div class="card">
          <h2><i class="fa-solid fa-paper-plane"></i> Agendar Mensagem</h2>
          <form onsubmit="salvar(event)">
            <div class="form-group">
              <label>Destino da Mensagem</label>
              <div class="radio-group">
                <label><input type="radio" name="tipo" value="contact" checked onchange="trocarTipoDestino(false)"> Contato Individual</label>
                <label><input type="radio" name="tipo" value="group" onchange="trocarTipoDestino(true)"> Grupo do WhatsApp</label>
              </div>

              <div id="campoContato">
                <input type="text" id="dest" required placeholder="Número com DDD (ex: 5511999998888)" oninput="atualizarNomeAoVivo()">
              </div>

              <div id="campoGrupo" style="display: none;">
                <select id="selectGrupo" onchange="atualizarNomeAoVivo()">
                  <option value="">Carregando seus grupos...</option>
                </select>
                <small style="color: #667781; display: block; margin-top: 4px;">* Escolha o grupo pelo nome</small>
              </div>
            </div>

            <div class="form-group">
              <label>Nome para Identificação (Opcional)</label>
              <input type="text" id="nome" placeholder="Ex: Cliente João ou Família" oninput="atualizarNomeAoVivo()">
            </div>

            <div class="form-group">
              <label><i class="fa-solid fa-paperclip"></i> Anexar Foto, Áudio ou Vídeo</label>
              <div class="media-btn-box" onclick="document.getElementById('fileInput').click()">
                <i class="fa-solid fa-cloud-arrow-up" style="font-size: 24px; color: #64748b;"></i>
                <p id="fileLabel" style="font-size: 13px; color: #54656f; margin-top: 4px;">Clique para escolher Foto, Áudio ou Vídeo</p>
              </div>
              <input type="file" id="fileInput" accept="image/*,video/*,audio/*" style="display: none;" onchange="aoCarregarArquivo(this)">
              <button type="button" id="btnRemoverMidia" style="display: none; margin-top: 6px; background: none; border: none; color: #ea4335; font-size: 12px; cursor: pointer;" onclick="aoRemoverArquivo()"><i class="fa-solid fa-trash"></i> Remover anexo</button>
            </div>

            <div class="form-group">
              <label>Texto da Mensagem</label>
              <div class="toolbar-msg">
                <button type="button" class="tool-btn" onclick="adicionarEmoji('😀')">😀</button>
                <button type="button" class="tool-btn" onclick="adicionarEmoji('❤️')">❤️</button>
                <button type="button" class="tool-btn" onclick="adicionarEmoji('🚀')">🚀</button>
                <button type="button" class="tool-btn" onclick="adicionarEmoji('📢')">📢</button>
                <button type="button" class="tool-btn" onclick="adicionarEmoji('📅')">📅</button>
                <button type="button" class="tool-btn" onclick="adicionarEmoji('👍')">👍</button>
              </div>
              <!-- Campo com ouvinte direto letra por letra -->
              <textarea id="msg" rows="4" placeholder="Digite sua mensagem aqui..." oninput="atualizarTextoAoVivo(this.value)" onkeyup="atualizarTextoAoVivo(this.value)"></textarea>
            </div>

            <!-- MÚLTIPLOS HORÁRIOS PARA A MESMA MENSAGEM -->
            <div class="form-group">
              <label style="font-weight: bold; color: #008069;"><i class="fa-solid fa-clock"></i> Horários de Envio (Você pode agendar para mais de um horário)</label>
              <div id="listaHorarios" style="display: flex; flex-direction: column; gap: 8px;">
                <div class="linha-horario" style="display: flex; gap: 8px; align-items: center;">
                  <input type="datetime-local" class="input-data-hora" required style="flex: 1; padding: 10px; border: 1px solid #d1d7db; border-radius: 6px;">
                </div>
              </div>
              <button type="button" onclick="adicionarOutroHorario()" style="margin-top: 8px; background: #e7f7f2; color: #008069; border: 1px dashed #00a884; padding: 10px 14px; border-radius: 6px; font-weight: bold; cursor: pointer; width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px;">
                <i class="fa-solid fa-plus-circle"></i> Adicionar outro horário para esta mesma mensagem
              </button>
            </div>

            <button type="submit" class="btn-submit"><i class="fa-solid fa-calendar-check"></i> Confirmar e Agendar</button>
          </form>
        </div>

        <!-- Balão do WhatsApp ao Vivo -->
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
                <img id="previewImg" class="wa-bubble-media" src="" alt="Foto">
                <video id="previewVideo" class="wa-bubble-media" controls src=""></video>
                <audio id="previewAudio" class="wa-bubble-media" controls src=""></audio>
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
    <div id="aba-agendadas" class="aba-item" style="display: none;">
      <div class="card">
        <h2><i class="fa-solid fa-clock"></i> Mensagens Agendadas</h2>
        <div id="listaAgendadas">Carregando agendamentos...</div>
      </div>
    </div>

    <!-- Aba 3: Calendário Mensal -->
    <div id="aba-calendario" class="aba-item" style="display: none;">
      <div class="card">
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
    </div>

    <!-- Aba 4: Conectar WhatsApp -->
    <div id="aba-conexao" class="aba-item" style="display: none;">
      <div class="card">
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
          <button type="button" class="tool-btn" style="padding: 10px 20px; font-weight: bold; font-size: 13px; border-radius: 6px;" onclick="document.getElementById('qrCodeImg').src = 'https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=WHATSAPP_' + Date.now();">
            <i class="fa-solid fa-rotate-right"></i> Gerar Novo QR Code
          </button>
        </div>
      </div>
    </div>
  </main>

  <script>
    var dados = [];
    var grupos = [];
    var mediaData = null;
    var mediaType = null;
    var mediaName = null;

    // 1. Alternador de Abas Universal
    function abrirAba(nome) {
      var abas = document.querySelectorAll('.aba-item');
      for (var i = 0; i < abas.length; i++) {
        abas[i].style.display = 'none';
      }
      var botoes = document.querySelectorAll('.nav-btn');
      for (var j = 0; j < botoes.length; j++) {
        botoes[j].classList.remove('active');
      }
      var alvo = document.getElementById('aba-' + nome);
      if (alvo) alvo.style.display = 'block';

      var btn = document.getElementById('btn-' + nome);
      if (btn) btn.classList.add('active');
    }

    // 2. Reflexo instantâneo do texto ao vivo letra por letra
    function atualizarTextoAoVivo(val) {
      var el = document.getElementById('previewTexto');
      if (el) {
        if (val && val.trim().length > 0) {
          el.textContent = val;
        } else {
          el.textContent = 'Sua mensagem vai aparecer aqui...';
        }
      }
    }

    // 3. Atualizar nome do destinatário ao vivo
    function atualizarNomeAoVivo() {
      var isGrupo = document.querySelector('input[name="tipo"]:checked').value === 'group';
      var nomeCustom = document.getElementById('nome').value;
      var el = document.getElementById('previewDestNome');
      if (!el) return;

      if (isGrupo) {
        var s = document.getElementById('selectGrupo');
        el.textContent = (s && s.options[s.selectedIndex]) ? s.options[s.selectedIndex].text : 'Grupo';
      } else {
        var dest = document.getElementById('dest').value;
        el.textContent = nomeCustom || dest || 'Destinatário';
      }
    }

    function trocarTipoDestino(isGrupo) {
      document.getElementById('campoContato').style.display = isGrupo ? 'none' : 'block';
      document.getElementById('campoGrupo').style.display = isGrupo ? 'block' : 'none';
      atualizarNomeAoVivo();
    }

    // 4. Carregar Foto / Vídeo / Áudio na tela na hora
    function aoCarregarArquivo(input) {
      if (!input.files || !input.files[0]) return;
      var file = input.files[0];
      mediaName = file.name;
      document.getElementById('fileLabel').textContent = 'Anexo: ' + file.name;
      document.getElementById('btnRemoverMidia').style.display = 'inline-block';

      var reader = new FileReader();
      reader.onload = function(e) {
        mediaData = e.target.result;
        var img = document.getElementById('previewImg');
        var vid = document.getElementById('previewVideo');
        var aud = document.getElementById('previewAudio');
        if (img) img.style.display = 'none';
        if (vid) vid.style.display = 'none';
        if (aud) aud.style.display = 'none';

        if (file.type.indexOf('image') !== -1 && img) {
          mediaType = 'image';
          img.src = mediaData;
          img.style.display = 'block';
        } else if (file.type.indexOf('video') !== -1 && vid) {
          mediaType = 'video';
          vid.src = mediaData;
          vid.style.display = 'block';
        } else if (file.type.indexOf('audio') !== -1 && aud) {
          mediaType = 'audio';
          aud.src = mediaData;
          aud.style.display = 'block';
        }
      };
      reader.readAsDataURL(file);
    }

    function aoRemoverArquivo() {
      mediaData = null; mediaType = null; mediaName = null;
      document.getElementById('fileInput').value = '';
      document.getElementById('fileLabel').textContent = 'Clique para escolher Foto, Áudio ou Vídeo';
      document.getElementById('btnRemoverMidia').style.display = 'none';
      var img = document.getElementById('previewImg');
      var vid = document.getElementById('previewVideo');
      var aud = document.getElementById('previewAudio');
      if (img) img.style.display = 'none';
      if (vid) vid.style.display = 'none';
      if (aud) aud.style.display = 'none';
    }

    function adicionarEmoji(emoji) {
      var txt = document.getElementById('msg');
      if (txt) {
        txt.value += emoji;
        atualizarTextoAoVivo(txt.value);
      }
    }

    // 5. Adicionar outro horário para a mesma mensagem
    function adicionarOutroHorario() {
      var container = document.getElementById('listaHorarios');
      var div = document.createElement('div');
      div.className = 'linha-horario';
      div.style.cssText = 'display: flex; gap: 8px; align-items: center; margin-top: 6px;';
      div.innerHTML = '<input type="datetime-local" class="input-data-hora" required style="flex: 1; padding: 10px; border: 1px solid #d1d7db; border-radius: 6px;">' +
        '<button type="button" onclick="this.parentElement.remove()" style="background: #fee2e2; color: #ef4444; border: 1px solid #fca5a5; padding: 10px 14px; border-radius: 6px; cursor: pointer; font-weight: bold;"><i class="fa-solid fa-trash"></i></button>';
      container.appendChild(div);
    }

    function carregarGrupos() {
      fetch('/api/groups').then(r => r.json()).then(res => {
        grupos = res;
        var select = document.getElementById('selectGrupo');
        if (select) {
          select.innerHTML = '<option value="">Selecione um grupo da lista...</option>' +
            grupos.map(g => '<option value="' + (g.id || g.jid) + '">' + (g.subject || g.name) + '</option>').join('');
        }
      }).catch(e => console.error(e));
    }

    function carregar() {
      fetch('/api/schedules').then(r => r.json()).then(res => {
        dados = res;
        var pend = dados.filter(x => x.status === 'pending');
        var l = document.getElementById('listaAgendadas');
        if (l) {
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
        }
      }).catch(e => console.error(e));
    }

    function renderizarGradeCalendario() {
      var container = document.getElementById('calDias');
      if (!container) return;
      var agora = new Date();
      var ano = agora.getFullYear();
      var mes = agora.getMonth();

      var nomesMeses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
      document.getElementById('calMesAno').textContent = nomesMeses[mes] + ' ' + ano;

      var primeiroDia = new Date(ano, mes, 1).getDay();
      var totalDias = new Date(ano, mes + 1, 0).getDate();

      var html = '';
      for (var i = 0; i < primeiroDia; i++) {
        html += '<div class="cal-cell" style="opacity: 0.3;"></div>';
      }

      for (var dia = 1; dia <= totalDias; dia++) {
        var dataIso = ano + '-' + (mes + 1 < 10 ? '0' : '') + (mes + 1) + '-' + (dia < 10 ? '0' : '') + dia;
        var eventosDia = dados.filter(x => x.scheduled_at && x.scheduled_at.indexOf(dataIso) === 0);
        var badges = eventosDia.map(e => '<span class="cal-badge">' + (e.recipient_name || 'Msg') + '</span>').join('');
        html += '<div class="cal-cell" onclick="verDia(\'' + dataIso + '\', ' + dia + ')"><b>' + dia + '</b>' + badges + '</div>';
      }
      container.innerHTML = html;
    }

    function verDia(dataIso, dia) {
      var eventos = dados.filter(x => x.scheduled_at && x.scheduled_at.indexOf(dataIso) === 0);
      var div = document.getElementById('calDetalheDia');
      if (div) div.style.display = 'block';
      document.getElementById('calTituloDetalhe').textContent = 'Agendamentos para o dia ' + dia + ' (' + eventos.length + ')';

      var lista = document.getElementById('calListaDetalhes');
      if (lista) {
        if (eventos.length === 0) {
          lista.innerHTML = '<p style="color: #64748b; font-size: 13px;">Nenhuma mensagem agendada para este dia.</p>';
        } else {
          lista.innerHTML = eventos.map(e => {
            return '<div class="item-card"><div><strong>' + (e.recipient_name || e.recipient) + '</strong><p>' + e.message + '</p><small>Horário: ' + new Date(e.scheduled_at).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'}) + '</small></div></div>';
          }).join('');
        }
      }
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

      // Pega todos os horários adicionados
      var inputs = document.querySelectorAll('.input-data-hora');
      var datas = [];
      for (var i = 0; i < inputs.length; i++) {
        if (inputs[i].value) datas.push(inputs[i].value);
      }

      if (datas.length === 0) {
        alert('Por favor, defina pelo menos uma data e hora!');
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
          scheduled_at_list: datas
        })
      }).then(r => {
        if (r.ok) {
          alert('Mensagem agendada com sucesso para ' + datas.length + ' horário(s)!');
          document.querySelector('form').reset();
          aoRemoverArquivo();
          abrirAba('agendadas');
          carregar();
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

    // Inicialização da hora atual
    var agora = new Date();
    var h = (agora.getHours() < 10 ? '0' : '') + agora.getHours();
    var m = (agora.getMinutes() < 10 ? '0' : '') + agora.getMinutes();
    var prevH = document.getElementById('previewHora');
    if (prevH) prevH.textContent = h + ':' + m;

    carregarGrupos();
    carregar();
  </script>
</body>
</html>`;

app.get('*', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.send(PAGE_HTML);
});

app.listen(PORT, () => console.log('Servidor rodando na porta ' + PORT));
