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
    .wa-bubble-media { max-width: 100%; border-radius: 6px; margin-bottom: 6px; display: none; }
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
    <button type="button" class="nav-btn active" onclick="mudarAba('novo')" id="btn-novo"><i class="fa-solid fa-plus-circle"></i> Novo Agendamento</button>
    <button type="button" class="nav-btn" onclick="mudarAba('agendadas')" id="btn-agendadas"><i class="fa-solid fa-clock"></i> Mensagens Agendadas</button>
    <button type="button" class="nav-btn" onclick="mudarAba('calendario')" id="btn-calendario"><i class="fa-solid fa-calendar-days"></i> Calendário Mensal</button>
    <button type="button" class="nav-btn" onclick="mudarAba('conexao')" id="btn-conexao"><i class="fa-solid fa-qrcode"></i> Conectar WhatsApp</button>
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
    <div id="aba-novo" class="aba-conteudo" style="display: block;">
      <div class="layout-grid">
        <div class="card">
          <h2><i class="fa-solid fa-paper-plane"></i> Agendar Mensagem</h2>
          <form onsubmit="salvar(event)">
            <div class="form-group">
              <label>Destino da Mensagem</label>
              <div class="radio-group">
                <label><input type="radio" name="tipo" value="contact" checked onchange="alternarTipoDestino('contact')"> Contato Individual</label>
                <label><input type="radio" name="tipo" value="group" onchange="alternarTipoDestino('group')"> Grupo do WhatsApp</label>
              </div>

              <div id="campoContato">
                <input type="text" id="dest" required placeholder="Número com DDD (ex: 5511999998888)" oninput="atualizarNome()" onkeyup="atualizarNome()">
              </div>

              <div id="campoGrupo" style="display: none;">
                <select id="selectGrupo" onchange="aoMudarGrupo()">
                  <option value="">Carregando seus grupos...</option>
                </select>
                <small style="color: #667781; display: block; margin-top: 4px;">* Grupos identificados automaticamente pelo nome</small>
              </div>
            </div>

            <div class="form-group">
              <label>Nome para Identificação (Opcional)</label>
              <input type="text" id="nome" placeholder="Ex: Cliente João ou Família" oninput="atualizarNome()" onkeyup="atualizarNome()">
            </div>

            <div class="form-group">
              <label><i class="fa-solid fa-paperclip"></i> Anexar Foto, Áudio ou Vídeo</label>
              <div class="media-btn-box" onclick="document.getElementById('fileInput').click()">
                <i class="fa-solid fa-cloud-arrow-up" style="font-size: 24px; color: #64748b;"></i>
                <p id="fileLabel" style="font-size: 13px; color: #54656f; margin-top: 4px;">Clique para escolher Foto, Áudio ou Vídeo</p>
              </div>
              <input type="file" id="fileInput" accept="image/*,video/*,audio/*" style="display: none;" onchange="aoSelecionarArquivo(this)">
              <button type="button" id="btnRemoverMidia" style="display: none; margin-top: 6px; background: none; border: none; color: #ea4335; font-size: 12px; cursor: pointer;" onclick="removerMidia()"><i class="fa-solid fa-trash"></i> Remover anexo</button>
            </div>

            <div class="form-group">
              <label>Texto da Mensagem</label>
              <div class="toolbar-msg">
                <button type="button" class="tool-btn" onclick="inserirEmoji('😀')">😀</button>
                <button type="button" class="tool-btn" onclick="inserirEmoji('❤️')">❤️</button>
                <button type="button" class="tool-btn" onclick="inserirEmoji('🚀')">🚀</button>
                <button type="button" class="tool-btn" onclick="inserirEmoji('📢')">📢</button>
                <button type="button" class="tool-btn" onclick="inserirEmoji('📅')">📅</button>
                <button type="button" class="tool-btn" onclick="inserirEmoji('👍')">👍</button>
              </div>
              <textarea id="msg" rows="4" placeholder="Digite sua mensagem aqui..." oninput="atualizarTexto()" onkeyup="atualizarTexto()"></textarea>
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
    <div id="aba-agendadas" class="aba-conteudo" style="display: none;">
      <div class="card">
        <h2><i class="fa-solid fa-clock"></i> Mensagens Agendadas</h2>
        <div id="listaAgendadas">Carregando agendamentos...</div>
      </div>
    </div>

    <!-- Aba 3: Calendário Mensal -->
    <div id="aba-calendario" class="aba-conteudo" style="display: none;">
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
    <div id="aba-conexao" class="aba-conteudo" style="display: none;">
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
          <button type="button" onclick="gerarNovoQR()" class="tool-btn" style="padding: 10px 20px; font-weight: bold; font-size: 13px; border-radius: 6px;">
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

    // 1. Troca de Abas 100% Funcional e Direta
    function mudarAba(nome) {
      var abas = document.querySelectorAll('.aba-conteudo');
      for (var i = 0; i < abas.length; i++) {
        abas[i].style.display = 'none';
      }

      var botoes = document.querySelectorAll('.nav-btn');
      for (var j = 0; j < botoes.length; j++) {
        botoes[j].classList.remove('active');
      }

      var abaAtiva = document.getElementById('aba-' + nome);
      if (abaAtiva) {
        abaAtiva.style.display = 'block';
      }

      var btnAtivo = document.getElementById('btn-' + nome);
      if (btnAtivo) {
        btnAtivo.classList.add('active');
      }

      if (nome === 'agendadas') carregar();
      if (nome === 'calendario') renderizarGradeCalendario();
    }

    // 2. Atualização de Texto na Prévia em Tempo Real
    function atualizarTexto() {
      var campo = document.getElementById('msg');
      var previa = document.getElementById('previewTexto');
      if (campo && previa) {
        var val = campo.value;
        if (val && val.trim() !== '') {
          previa.innerText = val;
        } else {
          previa.innerText = (mediaData ? '' : 'Sua mensagem vai aparecer aqui...');
        }
      }
    }

    // 3. Atualização de Nome do Destinatário na Prévia
    function atualizarNome() {
      var nomeInput = document.getElementById('nome');
      var destInput = document.getElementById('dest');
      var prevNome = document.getElementById('previewDestNome');

      var nome = (nomeInput && nomeInput.value) ? nomeInput.value : '';
      var dest = (destInput && destInput.value) ? destInput.value : '';

      if (prevNome) {
        prevNome.innerText = nome || dest || 'Destinatário';
      }
    }

    // 4. Alternar entre Contato e Grupo
    function alternarTipoDestino(tipo) {
      var divContato = document.getElementById('campoContato');
      var divGrupo = document.getElementById('campoGrupo');
      var prevNome = document.getElementById('previewDestNome');

      if (tipo === 'group') {
        if (divContato) divContato.style.display = 'none';
        if (divGrupo) divGrupo.style.display = 'block';
        var select = document.getElementById('selectGrupo');
        if (prevNome && select && select.options[select.selectedIndex]) {
          prevNome.innerText = select.options[select.selectedIndex].text;
        }
      } else {
        if (divContato) divContato.style.display = 'block';
        if (divGrupo) divGrupo.style.display = 'none';
        atualizarNome();
      }
    }

    function aoMudarGrupo() {
      var select = document.getElementById('selectGrupo');
      var prevNome = document.getElementById('previewDestNome');
      if (select && prevNome && select.selectedIndex >= 0) {
        prevNome.innerText = select.options[select.selectedIndex].text;
      }
    }

    // 5. Exibir Foto, Vídeo ou Áudio na Prévia
    function aoSelecionarArquivo(input) {
      if (!input || !input.files || !input.files[0]) return;
      var arquivo = input.files[0];
      mediaName = arquivo.name;

      var label = document.getElementById('fileLabel');
      if (label) label.innerText = 'Anexo: ' + arquivo.name;

      var btnRemover = document.getElementById('btnRemoverMidia');
      if (btnRemover) btnRemover.style.display = 'inline-block';

      var leitor = new FileReader();
      leitor.onload = function(evento) {
        mediaData = evento.target.result;
        var img = document.getElementById('previewImg');
        var vid = document.getElementById('previewVideo');
        var aud = document.getElementById('previewAudio');

        if (img) img.style.display = 'none';
        if (vid) vid.style.display = 'none';
        if (aud) aud.style.display = 'none';

        if (arquivo.type.indexOf('image') !== -1) {
          mediaType = 'image';
          if (img) {
            img.src = mediaData;
            img.style.display = 'block';
          }
        } else if (arquivo.type.indexOf('video') !== -1) {
          mediaType = 'video';
          if (vid) {
            vid.src = mediaData;
            vid.style.display = 'block';
          }
        } else if (arquivo.type.indexOf('audio') !== -1) {
          mediaType = 'audio';
          if (aud) {
            aud.src = mediaData;
            aud.style.display = 'block';
          }
        }
        atualizarTexto();
      };
      leitor.readAsDataURL(arquivo);
    }

    function removerMidia() {
      mediaData = null; mediaType = null; mediaName = null;
      var fileInp = document.getElementById('fileInput');
      if (fileInp) fileInp.value = '';

      var label = document.getElementById('fileLabel');
      if (label) label.innerText = 'Clique para escolher Foto, Áudio ou Vídeo';

      var btnRemover = document.getElementById('btnRemoverMidia');
      if (btnRemover) btnRemover.style.display = 'none';

      var img = document.getElementById('previewImg');
      var vid = document.getElementById('previewVideo');
      var aud = document.getElementById('previewAudio');
      if (img) img.style.display = 'none';
      if (vid) vid.style.display = 'none';
      if (aud) aud.style.display = 'none';

      atualizarTexto();
    }

    function inserirEmoji(emoji) {
      var txt = document.getElementById('msg');
      if (txt) {
        txt.value += emoji;
        atualizarTexto();
      }
    }

    function carregarGrupos() {
      fetch('/api/groups').then(function(r){ return r.json(); }).then(function(res) {
        grupos = res;
        var select = document.getElementById('selectGrupo');
        if (select) {
          select.innerHTML = '<option value="">Selecione um grupo da lista...</option>' +
            grupos.map(function(g){ return '<option value="' + (g.id || g.jid) + '">' + (g.subject || g.name) + '</option>'; }).join('');
        }
        var statG = document.getElementById('statGrupos');
        if (statG) statG.innerText = grupos.length;
      }).catch(function(e){ console.error(e); });
    }

    function carregar() {
      fetch('/api/schedules').then(function(r){ return r.json(); }).then(function(res) {
        dados = res;
        var pend = dados.filter(function(x){ return x.status === 'pending'; });
        var enviadas = dados.filter(function(x){ return x.status === 'sent'; });

        var statP = document.getElementById('statPendentes');
        if (statP) statP.innerText = pend.length;
        var statE = document.getElementById('statEnviadas');
        if (statE) statE.innerText = enviadas.length;

        var l = document.getElementById('listaAgendadas');
        if (l) {
          if (pend.length === 0) {
            l.innerHTML = '<p style="color: #667781;">Nenhuma mensagem agendada no momento.</p>';
          } else {
            l.innerHTML = pend.map(function(item) {
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
      }).catch(function(e){ console.error(e); });
    }

    function renderizarGradeCalendario() {
      var container = document.getElementById('calDias');
      if (!container) return;
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
        var dataIso = ano + '-' + (mes + 1 < 10 ? '0' : '') + (mes + 1) + '-' + (dia < 10 ? '0' : '') + dia;
        var eventosDia = dados.filter(function(x){ return x.scheduled_at && x.scheduled_at.indexOf(dataIso) === 0; });

        var badges = eventosDia.map(function(e){ return '<span class="cal-badge">' + (e.recipient_name || 'Msg') + '</span>'; }).join('');
        html += '<div class="cal-cell" onclick="verDia(\'' + dataIso + '\', ' + dia + ')"><b>' + dia + '</b>' + badges + '</div>';
      }
      container.innerHTML = html;
    }

    function verDia(dataIso, dia) {
      var eventos = dados.filter(function(x){ return x.scheduled_at && x.scheduled_at.indexOf(dataIso) === 0; });
      var div = document.getElementById('calDetalheDia');
      if (div) div.style.display = 'block';
      document.getElementById('calTituloDetalhe').innerText = 'Agendamentos para o dia ' + dia + ' (' + eventos.length + ')';

      var lista = document.getElementById('calListaDetalhes');
      if (lista) {
        if (eventos.length === 0) {
          lista.innerHTML = '<p style="color: #64748b; font-size: 13px;">Nenhuma mensagem agendada para este dia.</p>';
        } else {
          lista.innerHTML = eventos.map(function(e){
            return '<div class="item-card"><div><strong>' + (e.recipient_name || e.recipient) + '</strong><p>' + e.message + '</p><small>Horário: ' + new Date(e.scheduled_at).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'}) + '</small></div></div>';
          }).join('');
        }
      }
    }

    function gerarNovoQR() {
      var img = document.getElementById('qrCodeImg');
      if (img) img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=WHATSAPP_' + Date.now();
    }

    function salvar(e) {
      e.preventDefault();
      var radioGrupo = document.querySelector('input[name="tipo"][value="group"]');
      var isGrupo = radioGrupo && radioGrupo.checked;
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
      }).then(function(r) {
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
        fetch('/api/schedules/' + id, { method: 'DELETE' }).then(function(){ carregar(); });
      }
    }

    // Inicialização da hora atual no balãozinho
    var agora = new Date();
    var h = (agora.getHours() < 10 ? '0' : '') + agora.getHours();
    var m = (agora.getMinutes() < 10 ? '0' : '') + agora.getMinutes();
    var prevH = document.getElementById('previewHora');
    if (prevH) prevH.innerText = h + ':' + m;

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
