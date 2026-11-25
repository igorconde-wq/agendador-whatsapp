# Agendador WhatsApp em Nuvem

Agendador de mensagens para contatos individuais e grupos do WhatsApp com prévia em tempo real, envio de imagens, calendário mensal e conexão via código de pareamento de 8 dígitos.

## Requisitos

- Node.js 20+

## Como executar localmente

```bash
npm install
npm start
```

O servidor será iniciado em `http://localhost:3000` (ou na porta definida pela variável de ambiente `PORT`).

## Variáveis de ambiente

- `PORT`: porta HTTP do servidor (padrão: `3000`).
- `DATA_DIR`: diretório onde o banco SQLite (`schedules.db`) e as credenciais do WhatsApp (`auth_info_baileys`) serão salvos (padrão: diretório do projeto). Em deploys com Docker/nuvem, monte um volume persistente nesse caminho.

## Testes

```bash
npm test
```

## Docker

```bash
docker build -t agendador-whatsapp .
docker run -p 3000:3000 -v $(pwd)/data:/app/data -e DATA_DIR=/app/data agendador-whatsapp
```
