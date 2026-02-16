# CorreggiVerifiche AI - Backend API

Backend API per la correzione automatica delle verifiche scolastiche mediante intelligenza artificiale.

## Requisiti

- Node.js >= 18
- npm o bun

## Installazione Locale

```bash
npm install
npm run build
npm start
```

Il server sarà disponibile su `http://localhost:3001`

## Variabili d'Ambiente

| Variabile | Descrizione | Obbligatoria |
|-----------|-------------|--------------|
| `PORT` | Porta del server (default: 3001) | No |
| `FRONTEND_URL` | URL del frontend per CORS | No (consigliata) |

## Endpoints

### GET /health
Health check del server.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### POST /api/analyze
Analizza una verifica scolastica.

**Request Body:**
```json
{
  "image": "data:image/jpeg;base64,...",
  "subject": "italiano",
  "testType": "aperte",
  "maxScore": 10,
  "customInstructions": "..."
}
```

**Response:**
```json
{
  "result": {
    "studentName": "Mario Rossi",
    "subject": "Italiano",
    "totalScore": 7.5,
    "maxScore": 10,
    "percentage": 75,
    "grade": "8 buono",
    "questions": [...],
    "overallFeedback": "..."
  }
}
```

## Deploy su Render.com

1. Connetti questo repository a Render
2. Imposta Build Command: `npm install && npm run build`
3. Imposta Start Command: `npm start`
4. Configura le variabili d'ambiente
5. Deploy!

## Licenza

MIT
