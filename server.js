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

app.get('*', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>WhatsScheduler Nuvem</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>body{background:#0c1317;color:#e9edef;font-family:sans-serif}.wa-card{background:#111b21;border:1px solid #222e35}.wa-input{background:#2a3942;border:1px solid #3b4a54;color:#fff}.tab-act{border-bottom:3px solid #00a884;color:#00a884;font-weight:bold}</style>
</head>
<body class="min-h-screen flex flex-col">
  <header class="bg-[#202c33] p-4 flex justify-between items-center border-b border-[#313d45]">
    <div class="flex items-center gap-2"><i class="fa-brands fa-whatsapp text-green-500 text-2xl"></i><span class="font-bold">WhatsScheduler Nuvem</span></div>
    <span class="text-xs bg-green-900/60 text-green-400 px-3 py-1 rounded-full border border-green-700/50">Online 24h</span>
  </header>
  <nav class="bg-[#111b21] px-6 flex gap-6 text-sm border-b border-[#222e35]">
    <button onclick="tab('novo')" id="b-novo" class="py-3 tab-act">Novo Agendamento</button>
    <button onclick="tab('agendadas')" id="b-agendadas" class="py-3 text-gray-400">Mensagens Agendadas</button>
    <button onclick="tab('calendario')" id="b-calendario" class="py-3 text-gray-400">Calendário</button>
  </nav>
  <main class="p-6 max-w-3xl mx-auto w-full">
    <div id="t-novo" class="wa-card p-6 rounded-xl">
      <h2 class="text-lg font-semibold text-green-400 mb-4">Novo Agendamento</h2>
      <form onsubmit="save(event)" class="space-y-4">
        <div class="flex gap-4">
          <label><input type="radio" name="t" value="contact" checked onchange="toggle(false)"> Contato</label>
          <label><input type="radio" name="t" value="group" onchange="toggle(true)"> Grupo WhatsApp</label>
        </div>
        <input type="text" id="dest" required placeholder="Número (ex: 5511999998888)" class="wa-input w-full p-2.5 rounded-lg text-sm">
        <input type="text" id="nome" placeholder="Nome de identificação (opcional)" class="wa-input w-full p-2.5 rounded-lg text-sm">
        <textarea id="msg" required rows="3" placeholder="Mensagem..." class="wa-input w-full p-2.5 rounded-lg text-sm"></textarea>
        <input type="datetime-local" id="data" required class="wa-input w-full p-2.5 rounded-lg text-sm">
        <button class="bg-[#00a884] hover:bg-[#02906f] w-full p-3 rounded-lg font-semibold text-white">Agendar Mensagem</button>
      </form>
    </div>
    <div id="t-agendadas" class="wa-card p-6 rounded-xl hidden">
      <h2 class="text-lg font-semibold text-green-400 mb-4">Mensagens Agendadas</h2>
      <div id="lista" class="space-y-3"></div>
    </div>
    <div id="t-calendario" class="wa-card p-6 rounded-xl hidden">
      <h2 class="text-lg font-semibold text-green-400 mb-4">Calendário</h2>
      <div id="cal" class="space-y-3"></div>
    </div>
  </main>
  <script>
    let d = [];
    function tab(n){
      ['novo','agendadas','calendario'].forEach(x=>{
        document.getElementById('t-'+x).classList.toggle('hidden',x!==n);
        document.getElementById('b-'+x).className = x===n?'py-3 tab-act':'py-3 text-gray-400';
      });
      if(n!=='novo')load();
    }
    function toggle(g){document.getElementById('dest').placeholder=g?'ID do Grupo (ex: 1203630@g.us)':'Número (ex: 5511999998888)';}
    async function load(){
      const r = await fetch('/api/schedules'); d = await r.json();
      const pend = d.filter(x=>x.status==='pending');
      document.getElementById('lista').innerHTML = pend.length===0?'<p class="text-gray-400 text-sm">Nenhuma mensagem agendada.</p>':
        pend.map(i=>`<div class="bg-[#202c33] p-4 rounded-lg flex justify-between items-center border border-[#2a3942]"><div><p class="font-bold text-white">${i.recipient_name||i.recipient} (${i.recipient_type==='group'?'Grupo':'Contato'})</p><p class="text-sm text-gray-300 my-1">${i.message}</p><p class="text-xs text-gray-400">${new Date(i.scheduled_at).toLocaleString('pt-BR')}</p></div><button onclick="del(${i.id})" class="bg-red-600 text-xs px-3 py-2 rounded font-bold text-white">Cancelar</button></div>`).join('');
      document.getElementById('cal').innerHTML = d.length===0?'<p class="text-gray-400 text-sm">Nenhum evento registrado.</p>':
        d.map(i=>`<div class="bg-[#202c33] p-4 rounded-lg border border-[#2a3942] mb-2"><div class="flex justify-between text-xs mb-1"><span class="${i.status==='sent'?'text-green-400 font-bold':'text-yellow-400 font-bold'}">${i.status==='sent'?'✓ Enviada':'⏳ Agendada'}</span><span>${new Date(i.scheduled_at).toLocaleString('pt-BR')}</span></div><p class="text-xs text-gray-300"><strong>Destino:</strong> ${i.recipient_name||i.recipient} (${i.recipient_type==='group'?'Grupo':'Contato'})</p><p class="text-xs text-white mt-1"><strong>Texto:</strong> ${i.message}</p></div>`).join('');
    }
    async function save(e){
      e.preventDefault();
      await fetch('/api/schedules',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        recipient_type:document.querySelector('input[name="t"]:checked').value,
        recipient:document.getElementById('dest').value,
        recipient_name:document.getElementById('nome').value,
        message:document.getElementById('msg').value,
        scheduled_at:document.getElementById('data').value
      })});
      alert('Agendado com sucesso!'); tab('agendadas');
    }
    async function del(id){if(confirm('Cancelar agendamento?')){await fetch('/api/schedules/'+id,{method:'DELETE'});load();}}
  </script>
</body>
</html>`);
});

app.listen(PORT, () => console.log('Servidor rodando na porta ' + PORT));
