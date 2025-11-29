# Live Syntax

Live Syntax is a collaborative, real-time code editor with a built-in AI assistant and live compilation. It uses CodeMirror on the client, Socket.IO for real-time collaboration (multi-cursor, selections), an Express + Socket.IO server, a Groq AI integration (provisioned via environment variable), and the Piston API for running code.

Demo:
- Frontend: https://live-syntax.vercel.app/
- Backend: https://live-syntax-production.up.railway.app/

**Overview**
- Real-time collaborative editor (multiple users can edit simultaneously).
- Color-coded cursors and selections per user.
- AI assistant that returns corrected code (structured responses).
- Server-side compilation using the Piston API.

**Tech stack**
- Frontend: React, CodeMirror, Socket.IO client
- Backend: Node.js, Express, Socket.IO server
- AI: Groq API (key stored in env; project refers to it under `HUGGINGFACE_API_KEY` in server for obfuscation)
- Compilation: Piston (no key required)

**Repository structure**
```
client/
  package.json
  src/
    components/
      Editor.js
      EditorPage.js
      Home.js
      Client.js
    Socket.js
server/
  index.js
  Actions.js
  package.json
  .env (local, NOT committed)
```

**Prerequisites**
- Node.js (v16+ recommended) and npm
- Recommended: Git for cloning and pushing

## Local development

1. Clone the repository

```bash
git clone https://github.com/rishi-durgapal/Live-Syntax.git
cd "Live Syntax"
```

2. Install dependencies

```bash
# Server
cd server
npm install

# Client (in new terminal)
cd ../client
npm install
```

3. Environment variables

Create a `server/.env` file (do not commit `.env` to GitHub). The server expects at least:

```
HUGGINGFACE_API_KEY=<your_api_key_here>
FRONTEND_URL=https://your-frontend-domain.example
PORT=5002 # optional, default 5002
```

Notes:
- The code uses `HUGGINGFACE_API_KEY` as the environment variable name in the server; it contains the Groq API key in this repo's setup.
- The Piston API used for compilation does not require a key.

For the client, during local development create `client/.env`:

```
REACT_APP_BACKEND_URL=http://localhost:5002
```

For production builds on Vercel, set `REACT_APP_BACKEND_URL` in the Vercel Project Environment Variables (Production).

4. Run server and client

```bash
# Terminal 1 (server)
cd server
npm start

# Terminal 2 (client)
cd client
npm start
```

Open `http://localhost:3000` in your browser.

## Deployment notes

Recommended pairing:
- Frontend: Vercel
- Backend: Railway

Server (Railway):
- Add `HUGGINGFACE_API_KEY` as an environment variable in Railway (value = your Groq key if using Groq). 
- Set `FRONTEND_URL` to your Vercel URL (e.g. `https://live-syntax.vercel.app`).
- Railway will auto-redeploy when variables change.

Client (Vercel):
- Add `REACT_APP_BACKEND_URL` to Vercel's Environment Variables (Production) with value like `https://live-syntax-production.up.railway.app`.
- Redeploy the project so the production build includes the correct backend URL.

## Common troubleshooting

- Socket connection failed:
  - Check `client` console for the `Connecting to backend:` message; it shows the URL the client is attempting.
  - Verify `REACT_APP_BACKEND_URL` is set in Vercel and the value is the correct Railway domain.
  - Check `https://<railway-domain>/health` — should return `{"status":"running"}`.
  - In Railway, check Deployments and Logs for any server-side errors.
  - Hard refresh the browser (Ctrl/Cmd + Shift + R) to clear cached frontend code after a redeploy.

- CORS issues:
  - Ensure `FRONTEND_URL` is configured in Railway and server allows that origin in CORS settings.

- If you see `Cannot GET /` when visiting the Railway root URL directly, that's okay — the server may not serve a frontend at `/`; check `/health`.

## Security & secrets
- Never commit `.env` to GitHub.
- Keep API keys private and rotate them if exposed.

## Features implemented
- Real-time delta-based synchronization
- Multi-cursor support with user-colored cursors
- Selection highlighting (handles top-to-bottom and bottom-to-top selection)
- AI assistant endpoint that returns `Corrected Code:` output
- Piston-based compilation endpoint




