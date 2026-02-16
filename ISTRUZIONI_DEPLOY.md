# 🚀 Guida Completa al Deploy - CorreggiVerifiche AI

Questa guida ti accompagnerà passo-passo nel deploy dell'applicazione CorreggiVerifiche AI utilizzando:
- **Frontend**: Hosting statico (Netlify, Vercel, GitHub Pages, ecc.)
- **Backend**: Render.com con GitHub

---

## 📁 Struttura del Progetto

```
deploy/
├── backend/                 # API per Render.com
│   ├── src/
│   │   └── index.ts        # Server Express principale
│   ├── package.json
│   ├── tsconfig.json
│   └── render.yaml         # Configurazione Render
│
├── frontend/
│   └── index.html          # Frontend statico
│
└── ISTRUZIONI_DEPLOY.md    # Questa guida
```

---

## 🔧 PARTE 1: Preparazione Backend

### 1.1 Creare Repository GitHub per il Backend

1. Vai su [GitHub](https://github.com) e crea un **nuovo repository**
2. Nome suggerito: `correggi-verifiche-api`
3. Imposta come **Private** (consigliato) o Public

### 1.2 Preparare i File

Copia la cartella `backend/` nel tuo nuovo repository:

```bash
# Clona il repository
git clone https://github.com/TUO-USERNAME/correggi-verifiche-api.git
cd correggi-verifiche-api

# Copia i file dal progetto
# - package.json
# - tsconfig.json
# - render.yaml
# - src/index.ts

# Commit iniziale
git add .
git commit -m "Initial commit - Backend API"
git push origin main
```

---

## 🚀 PARTE 2: Deploy Backend su Render.com

### 2.1 Creare Account Render

1. Vai su [Render.com](https://render.com)
2. Clicca **"Get Started"** e registrati (consigliato: usa GitHub)

### 2.2 Creare il Web Service

1. Dashboard → **"New +"** → **"Web Service"**
2. Connetti il repository GitHub `correggi-verifiche-api`
3. Configura:

| Campo | Valore |
|-------|--------|
| **Name** | `correggi-verifiche-api` |
| **Region** | `Frankfurt (eu-central-1)` o `Oregon (us-west-2)` |
| **Branch** | `main` |
| **Root Directory** | (lascia vuoto) |
| **Runtime** | `Node` |
| **Build Command** | `npm install && npm run build` |
| **Start Command** | `npm start` |
| **Instance Type** | `Free` (o Starter per produzione) |

### 2.3 Configurare Variabili d'Ambiente

In **"Advanced"** → **"Add Environment Variable"**:

| Key | Value |
|-----|-------|
| `NODE_VERSION` | `18` |
| `FRONTEND_URL` | `https://tuosito.com` (da completare dopo il deploy frontend) |

### 2.4 Deploy

1. Clicca **"Create Web Service"**
2. Attendi il completamento del build (2-5 minuti)
3. Annota l'URL del servizio, es: `https://correggi-verifiche-api.onrender.com`

### 2.5 Verificare il Funzionamento

Visita: `https://correggi-verifiche-api.onrender.com/health`

Dovresti vedere:
```json
{"status":"ok","timestamp":"2024-..."}
```

---

## 🌐 PARTE 3: Deploy Frontend Statico

### 3.1 Configurare l'URL del Backend

Modifica il file `frontend/index.html`, riga ~14:

```javascript
const API_BASE_URL = 'https://correggi-verifiche-api.onrender.com';
```

Sostituisci con l'URL del tuo backend Render.

### 3.2 Opzioni di Hosting

#### Opzione A: GitHub Pages (Gratuito)

1. Crea un repository GitHub: `correggi-verifiche-web`
2. Carica il file `index.html` nella root
3. Vai su **Settings** → **Pages**
4. Source: `Deploy from a branch` → `main` → `/ (root)`
5. Il sito sarà disponibile su: `https://tuousername.github.io/correggi-verifiche-web`

#### Opzione B: Netlify (Gratuito)

1. Vai su [Netlify](https://netlify.com)
2. **"Add new site"** → **"Deploy manually"**
3. Trascina la cartella `frontend/`
4. Il sito sarà immediatamente online
5. Puoi personalizzare il dominio

#### Opzione C: Vercel (Gratuito)

1. Vai su [Vercel](https://vercel.com)
2. **"Add New"** → **"Project"**
3. Importa il repository GitHub con `index.html`
4. Deploy automatico

#### Opzione D: Hosting Tradizionale

1. Carica `index.html` via FTP sul tuo hosting
2. Assicurati che sia nella cartella `public_html` o equivalente

### 3.3 Aggiornare CORS nel Backend

Dopo il deploy del frontend, aggiorna la variabile `FRONTEND_URL` su Render:

1. Dashboard Render → Tuo Web Service → **Environment**
2. Modifica `FRONTEND_URL` con l'URL del frontend
3. Il servizio si riavvierà automaticamente

---

## 🔒 PARTE 4: Considerazioni di Sicurezza

### 4.1 Variabili d'Ambiente

Il backend utilizza `z-ai-web-dev-sdk` che gestisce automaticamente le credenziali AI. Assicurati:
- Le variabili d'ambiente siano configurate correttamente
- Il repository backend sia privato (se contiene configurazioni sensibili)

### 4.2 Rate Limiting (Consigliato)

Per evitare abusi, aggiungi un rate limiter al backend. In `src/index.ts`:

```typescript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minuti
  max: 100 // max 100 richieste per IP
});

app.use('/api/', limiter);
```

### 4.3 HTTPS

- Render fornisce automaticamente certificati SSL
- Assicurati che il frontend sia servito su HTTPS

---

## 📊 PARTE 5: Monitoraggio

### 5.1 Log di Render

- Dashboard → Tuo Web Service → **Logs**
- Visibili in tempo reale

### 5.2 Metriche

Render Free tier include:
- CPU e memoria base
- Bandwidth limitato

Per produzione, considera l'upgrade a **Starter** ($7/mese).

---

## 🔄 PARTE 6: Aggiornamenti

### Aggiornare il Backend

```bash
cd correggi-verifiche-api
# Modifica i file
git add .
git commit -m "Update features"
git push origin main
# Render farà automaticamente il redeploy
```

### Aggiornare il Frontend

- **GitHub Pages**: Push su main, attendi qualche minuto
- **Netlify**: Ridragga la cartella o connetti a GitHub per auto-deploy
- **Vercel**: Auto-deploy da GitHub

---

## ❓ Troubleshooting

### Il backend non si avvia

1. Controlla i log su Render
2. Verifica che `npm run build` e `npm start` funzionino localmente
3. Controlla che `NODE_VERSION` sia impostato a 18

### Errore CORS

1. Verifica che `FRONTEND_URL` sia impostato correttamente
2. Assicurati che il protocollo sia corretto (https://)
3. Non includere slash finali nell'URL

### Timeout dell'analisi AI

- L'analisi può richiedere 30-60 secondi
- Il piano gratuito di Render ha limitazioni
- Considera l'upgrade per performance migliori

### Immagine non analizzata

1. Verifica che l'immagine sia in formato valido (JPEG, PNG)
2. Controlla che la dimensione sia < 10MB
3. Verifica i log del backend

---

## 📞 Supporto

- **Render Docs**: https://render.com/docs
- **GitHub Pages Docs**: https://docs.github.com/pages
- **Netlify Docs**: https://docs.netlify.com

---

## ✅ Checklist Finale

- [ ] Repository backend creato su GitHub
- [ ] Backend deployato su Render
- [ ] Health check funzionante
- [ ] URL backend configurato nel frontend
- [ ] Frontend deployato su hosting statico
- [ ] CORS configurato correttamente
- [ ] Test completo: upload immagine → analisi → risultati

Buon deploy! 🎉
