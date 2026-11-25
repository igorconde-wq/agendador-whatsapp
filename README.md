# Agendador WhatsApp

Agendador de mensagens para contatos individuais e grupos do WhatsApp com prévia em tempo real, envio de imagens, calendário mensal e conexão via código de pareamento de 8 dígitos.

## Como rodar no seu computador (Windows)

1. Instale o **Node.js 20+ (LTS)** em https://nodejs.org (se ainda não tiver).
2. Baixe o projeto (clique em **Code → Download ZIP** no GitHub e extraia a pasta, ou use `git clone`).
3. Dê **dois cliques em `iniciar.bat`**.
   - Na primeira vez ele instala as dependências automaticamente.
   - Depois abre `http://localhost:3000` direto no seu navegador.
4. Os agendamentos (`schedules.db`) e a sessão do WhatsApp (`auth_info_baileys/`) ficam salvos direto na pasta do projeto no seu PC — não se perdem ao reiniciar.

## Como rodar via terminal (Windows, Mac ou Linux)

```bash
npm install
npm start
```

Depois acesse `http://localhost:3000` no navegador.

## Variáveis de ambiente (opcional)

- `PORT`: porta HTTP do servidor (padrão: `3000`).
- `DATA_DIR`: diretório onde o banco SQLite (`schedules.db`) e as credenciais do WhatsApp (`auth_info_baileys`) serão salvos (padrão: diretório do projeto).

## Testes

```bash
npm test
```

## Docker (opcional)

```bash
docker build -t agendador-whatsapp .
docker run -p 3000:3000 -v $(pwd)/data:/app/data -e DATA_DIR=/app/data agendador-whatsapp
```
