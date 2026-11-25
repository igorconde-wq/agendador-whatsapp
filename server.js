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
    .form-group { margin-bottom: 14px
