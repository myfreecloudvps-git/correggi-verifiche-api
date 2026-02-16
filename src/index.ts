import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';

// Load environment variables
dotenv.config();

// Types
interface AnalysisRequest {
  image: string;
  subject: string;
  testType: string;
  customInstructions?: string;
  maxScore: number;
}

interface Question {
  id: string;
  number: number;
  text: string;
  studentAnswer: string;
  correctAnswer?: string;
  score: number;
  maxScore: number;
  feedback: string;
  isCorrect: boolean;
  confirmed: boolean | null;
}

// API Configuration
const PORT = process.env.PORT || 3001;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

// Initialize Google AI
const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY || '');

// Safety settings - block as little as possible for educational content analysis
const safetySettings = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
  },
];

// Helper to get model
function getModel(modelName: string = 'gemini-flash-latest') {
  return genAI.getGenerativeModel({ model: modelName, safetySettings });
}

// Italian grade calculation
function calculateGrade(percentage: number): string {
  if (percentage >= 95) return "10 eccellente";
  if (percentage >= 85) return "9 distinto";
  if (percentage >= 75) return "8 buono";
  if (percentage >= 65) return "7 discreto";
  if (percentage >= 55) return "6 sufficiente";
  if (percentage >= 45) return "5 insufficiente";
  if (percentage >= 35) return "4 gravemente insufficiente";
  if (percentage >= 25) return "3 molto gravemente insufficiente";
  return "1-2 gravemente insufficiente";
}

// Initialize Express
const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json({ limit: '50mb' }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Debug endpoint
app.get('/debug', async (req, res) => {
  const hasApiKey = !!GOOGLE_API_KEY;

  let chatWorks = false;
  let visionWorks = false;
  let chatError = null;
  let visionError = null;

  // Test chat
  try {
    if (!hasApiKey) throw new Error('GOOGLE_API_KEY non configurata');

    const model = getModel();
    const result = await model.generateContent('Rispondi solo: ok');
    const response = result.response.text();
    chatWorks = !!response;
  } catch (e) {
    chatError = e instanceof Error ? e.message : String(e);
  }

  // Test vision (using a text-only prompt to check model access, as actual vision test requires valid base64)
  // We can just reuse the chat test for basic model availability since gemini-1.5-flash is multimodal
  visionWorks = chatWorks;
  if (!chatWorks) visionError = chatError;

  res.json({
    config: { hasApiKey, provider: 'Google Gemini' },
    chat: { works: chatWorks, error: chatError },
    vision: { works: visionWorks, error: visionError },
    recommendation: chatWorks
      ? "✅ Tutto funzionante!"
      : "❌ Verifica la tua API Key di Google AI",
    timestamp: new Date().toISOString()
  });
});

// Test endpoint - returns raw AI response for debugging
app.post('/api/test-vision', async (req, res) => {
  try {
    const { image } = req.body;

    if (!image) {
      return res.status(400).json({ error: 'Immagine mancante' });
    }

    if (!GOOGLE_API_KEY) {
      return res.status(500).json({ error: 'GOOGLE_API_KEY mancante' });
    }

    console.log('[TEST] ========================================');
    console.log('[TEST] Testing vision with image...');

    // Process image
    let imagePart;
    let mimeType = 'image/jpeg'; // Default

    if (image.startsWith('data:')) {
      const match = image.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        mimeType = match[1];
        imagePart = {
          inlineData: {
            data: match[2],
            mimeType: mimeType
          }
        };
      } else {
        throw new Error('Formato data URI non valido');
      }
    } else {
      // Assume raw base64
      imagePart = {
        inlineData: {
          data: image,
          mimeType: 'image/jpeg'
        }
      };
    }

    console.log(`[TEST] MimeType: ${mimeType}`);

    const prompt = `Guarda questa immagine e descrivi esattamente cosa vedi. Rispondi in italiano.`;

    // Try different models if available, but primarily flash
    const modelName = 'gemini-flash-latest';
    const model = getModel(modelName);

    console.log(`[TEST] Calling model: ${modelName}`);

    const result = await model.generateContent([prompt, imagePart]);
    const response = result.response;
    const text = response.text();

    console.log('[TEST] Response received');
    console.log('[TEST] ========================================');

    res.json({
      success: true,
      text: text,
      model: modelName
    });

  } catch (error) {
    console.error('[TEST] Error:', error);
    res.json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
  }
});

// Main analysis endpoint
app.post('/api/analyze', async (req, res) => {
  console.log('[ANALYZE] ========================================');
  console.log('[ANALYZE] Ricevuta richiesta di analisi');

  try {
    const { image, subject, testType, customInstructions, maxScore } = req.body;

    // Validate
    if (!image) return res.status(400).json({ error: 'Immagine mancante' });
    if (!subject) return res.status(400).json({ error: 'Materia mancante' });
    if (!testType) return res.status(400).json({ error: 'Tipo di verifica mancante' });
    if (!GOOGLE_API_KEY) return res.status(500).json({ error: 'Configurazione server incompleta (API KEY Mancante)' });

    console.log(`[ANALYZE] Materia: ${subject}, Tipo: ${testType}, MaxScore: ${maxScore}`);

    // Prepare Image
    let imagePart;
    if (image.startsWith('data:')) {
      const match = image.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        imagePart = {
          inlineData: {
            data: match[2],
            mimeType: match[1]
          }
        };
      } else {
        throw new Error('Formato immagine non valido');
      }
    } else {
      imagePart = {
        inlineData: {
          data: image,
          mimeType: 'image/jpeg'
        }
      };
    }

    // Comprehensive prompt
    const analysisPrompt = `Sei un insegnante italiano esperto di ${subject}. Analizza questa immagine di una verifica scolastica.

ISTRUZIONI IMPORTANTI:
1. Guarda attentamente l'immagine
2. Identifica TUTTE le domande presenti (possono essere Vero/Falso, a risposta multipla, o aperte)
3. Per ogni domanda, leggi la risposta data dallo studente
4. Valuta se la risposta è corretta o no
5. Il punteggio massimo totale è ${maxScore} punti. Distribuisci i punti in modo logico se non specificati.

TIPO DI VERIFICA: ${testType}
${customInstructions ? `ISTRUZIONI AGGIUNTIVE: ${customInstructions}` : ''}

Rispondi ESCLUSIVAMENTE con un JSON valido in questo formato esatto:
{
  "studentName": "nome dello studente o stringa vuota",
  "totalQuestions": number,
  "questions": [
    {
      "number": 1,
      "text": "testo completo della domanda",
      "type": "vero_falso" | "multipla" | "aperta",
      "studentAnswer": "risposta data dallo studente",
      "correctAnswer": "risposta corretta",
      "isCorrect": boolean,
      "score": number, 
      "feedback": "feedback breve per lo studente"
    }
  ],
  "overallFeedback": "commento generale sulla verifica",
  "totalScore": number
}

IMPORTANTE: 
- Identifica TUTTE le domande visibili
- Assegna punti la cui somma sia vicina o uguale a ${maxScore}
- Se una risposta non è leggibile, metti "ILLEGIBILE" come studentAnswer e 0 punti
- Non includere markdown tipo \`\`\`json o \`\`\`. Restituisci SOLO il JSON puro.`;

    // Call Gemini
    const model = getModel('gemini-flash-latest'); // Using flash for speed, switch to pro if better reasoning needed

    console.log('[ANALYZE] Calling Gemini...');

    // We request JSON response MIME type if supported by the library version, 
    // but usually prompt engineering is enough. 
    // For strictly typed JSON, we can use generationConfig responseMimeType: "application/json"

    const generationResult = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: analysisPrompt }, imagePart] }],
      generationConfig: {
        responseMimeType: "application/json"
      }
    });

    const response = generationResult.response;
    const responseText = response.text();

    console.log('[ANALYZE] Content length:', responseText.length);
    console.log('[ANALYZE] Content preview:', responseText.substring(0, 200));

    // Parse JSON
    let analysisResult: any;
    try {
      // Cleanup markdown if present (even with responseMimeType it might happen slightly differently depending on version)
      const cleanText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
      analysisResult = JSON.parse(cleanText);
    } catch (parseError) {
      console.error('[ANALYZE] JSON parse error:', parseError);
      return res.status(500).json({
        error: 'Errore nel parsing della risposta AI',
        rawResponse: responseText.substring(0, 1000)
      });
    }

    // Validate and Clean Structure
    if (!analysisResult.questions || !Array.isArray(analysisResult.questions)) {
      console.error('[ANALYZE] Invalid structure:', analysisResult);
      return res.status(500).json({
        error: 'Struttura risposta non valida',
        received: analysisResult
      });
    }

    const questionsPerScore = maxScore / (analysisResult.questions.length || 1);

    const finalQuestions: Question[] = analysisResult.questions.map((q: any, index: number) => {
      // Ensure score helps sum to total or is reasonable
      let score = typeof q.score === 'number' ? q.score : (q.isCorrect ? questionsPerScore : 0);

      return {
        id: `q-${q.number || index + 1}-${Date.now()}`,
        number: q.number || index + 1,
        text: q.text || `Domanda ${q.number || index + 1}`,
        studentAnswer: q.studentAnswer || '',
        correctAnswer: q.correctAnswer || '',
        score: Math.round(score * 10) / 10,
        maxScore: questionsPerScore, // Or derive from q.maxScore if model provides it
        feedback: q.feedback || (q.isCorrect ? 'Corretto' : 'Non corretto'),
        isCorrect: q.isCorrect ?? false,
        confirmed: null
      };
    });

    // Recalculate totals based on parsed questions to be safe
    const totalScore = finalQuestions.reduce((sum, q) => sum + q.score, 0);
    const percentage = (totalScore / maxScore) * 100;

    const result = {
      studentName: analysisResult.studentName || '',
      subject: subject.charAt(0).toUpperCase() + subject.slice(1),
      totalScore: Math.round(totalScore * 10) / 10,
      maxScore,
      percentage: Math.round(percentage * 10) / 10,
      grade: calculateGrade(percentage),
      questions: finalQuestions,
      overallFeedback: analysisResult.overallFeedback || 'Analisi completata.'
    };

    console.log(`[ANALYZE] Result: ${finalQuestions.length} questions, score ${totalScore}/${maxScore}`);

    res.json({ result });

  } catch (error) {
    console.error('[ANALYZE] Error:', error);
    res.status(500).json({
      error: 'Errore durante l\'analisi',
      message: error instanceof Error ? error.message : 'Errore sconosciuto'
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server avviato sulla porta ${PORT} (Google AI)`);
  console.log(`📍 Health: http://localhost:${PORT}/health`);
  console.log(`🔍 Debug: http://localhost:${PORT}/debug`);
  console.log(`🔑 API Key: ${!!GOOGLE_API_KEY ? 'Presente' : 'MANCANTE'}`);
});
