import express from 'express';
import cors from 'cors';
import ZAI from 'z-ai-web-dev-sdk';

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

interface CorrectionResult {
  studentName: string;
  subject: string;
  totalScore: number;
  maxScore: number;
  percentage: number;
  grade: string;
  questions: Question[];
  overallFeedback: string;
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

// Get subject-specific instructions
function getSubjectInstructions(subject: string): string {
  const instructions: Record<string, string> = {
    'italiano': 'Valuta la correttezza grammaticale, la sintassi, l\'ortografia e la qualità espositiva.',
    'matematica': 'Valuta la correttezza dei calcoli, la logica di risoluzione e l\'applicazione delle formule.',
    'storia': 'Valuta la conoscenza degli eventi storici e la capacità di contestualizzazione.',
    'geografia': 'Valuta la conoscenza geografica e la capacità di localizzazione.',
    'scienze': 'Valuta la conoscenza scientifica e la comprensione dei fenomeni.',
    'inglese': 'Valuta la correttezza grammaticale e il vocabolario.',
  };
  return instructions[subject] || 'Valuta la correttezza delle risposte.';
}

// Get test type instructions
function getTestTypeInstructions(testType: string): string {
  const instructions: Record<string, string> = {
    'aperte': 'Le domande sono a risposta aperta. Valuta completezza e accuratezza.',
    'chiuse': 'Le domande sono a risposta chiusa. Valuta la correttezza della risposta.',
    'miste': 'La verifica contiene domande aperte e chiuse.',
    'dettato': 'Valuta la correttezza ortografica e la punteggiatura.',
    'problemi': 'Valuta il procedimento risolutivo e i calcoli.',
    'comprensione': 'Valuta la capacità di comprendere e interpretare il testo.',
    'riassunto': 'Valuta la capacità di sintetizzare.',
  };
  return instructions[testType] || 'Valuta le risposte.';
}

// Initialize Express
const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));

// Initialize ZAI with explicit config
let zaiInstance: Awaited<ReturnType<typeof ZAI.create>> | null = null;

async function initZAI() {
  if (!zaiInstance) {
    console.log('[INIT] Inizializzazione ZAI SDK...');
    
    const apiKey = process.env.ZAI_API_KEY;
    const apiBaseUrl = process.env.ZAI_API_BASE_URL;
    
    console.log('[INIT] API Key presente:', !!apiKey);
    console.log('[INIT] API Base URL:', apiBaseUrl || 'non specificato');
    
    try {
      // Pass config directly to ZAI.create() if API key is available
      if (apiKey) {
        // Try passing config object directly
        zaiInstance = await ZAI.create({
          apiKey: apiKey,
          ...(apiBaseUrl && { apiBaseUrl: apiBaseUrl })
        });
      } else {
        // Fall back to default config lookup
        zaiInstance = await ZAI.create();
      }
      console.log('[INIT] ZAI SDK inizializzato con successo');
    } catch (error) {
      console.error('[INIT] Errore inizializzazione ZAI SDK:', error);
      throw error;
    }
  }
  return zaiInstance;
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Debug endpoint
app.get('/debug', async (req, res) => {
  const apiKey = process.env.ZAI_API_KEY;
  const apiBaseUrl = process.env.ZAI_API_BASE_URL;
  
  let zaiStatus = 'not_initialized';
  let initError = null;
  
  try {
    await initZAI();
    zaiStatus = 'initialized';
  } catch (e) {
    zaiStatus = 'error';
    initError = e instanceof Error ? e.message : String(e);
  }
  
  res.json({ 
    hasApiKey: !!apiKey,
    apiKeyLength: apiKey?.length || 0,
    apiBaseUrl: apiBaseUrl || 'not set',
    zaiStatus,
    initError,
    timestamp: new Date().toISOString() 
  });
});

// Main analysis endpoint
app.post('/api/analyze', async (req, res) => {
  console.log('[API] Ricevuta richiesta di analisi');
  
  try {
    const body: AnalysisRequest = req.body;
    const { image, subject, testType, customInstructions, maxScore } = body;

    // Validate input
    if (!image) {
      return res.status(400).json({ error: 'Immagine mancante' });
    }
    if (!subject) {
      return res.status(400).json({ error: 'Materia mancante' });
    }
    if (!testType) {
      return res.status(400).json({ error: 'Tipo di verifica mancante' });
    }

    console.log(`[API] Parametri: materia=${subject}, tipo=${testType}, maxScore=${maxScore}`);
    console.log(`[API] Dimensione immagine: ${image.length} caratteri`);

    // Initialize ZAI
    console.log('[API] Inizializzazione ZAI...');
    const zai = await initZAI();
    console.log('[API] ZAI pronto');

    // Step 1: Extract text from image using VLM
    console.log('[API] Step 1: Estrazione testo con VLM...');
    
    const extractionPrompt = `Analizza questa immagine di una verifica scolastica italiana. 
Estrai TUTTO il testo che vedi nell'immagine:
- Il nome dello studente se presente
- Le domande numerate
- Le risposte scritte dallo studente

Rispondi ESCLUSIVAMENTE in formato JSON valido:
{
  "studentName": "nome dello studente o stringa vuota se non presente",
  "questions": [
    {
      "number": 1,
      "text": "testo della domanda",
      "studentAnswer": "risposta scritta dallo studente"
    }
  ]
}`;

    let extractionResponse;
    try {
      extractionResponse = await zai.chat.completions.createVision({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: extractionPrompt },
              { type: 'image_url', image_url: { url: image } }
            ]
          }
        ]
      } as any);
      console.log('[API] VLM risposta ricevuta');
    } catch (vlmError) {
      console.error('[API] Errore VLM:', vlmError);
      return res.status(500).json({ 
        error: 'Errore nell\'analisi dell\'immagine.',
        details: vlmError instanceof Error ? vlmError.message : String(vlmError)
      });
    }

    const extractionResult = extractionResponse.choices?.[0]?.message?.content;
    console.log('[API] Risultato estrazione (primi 200 char):', extractionResult?.substring(0, 200));
    
    let extractedData: { studentName: string; questions: Array<{number: number; text: string; studentAnswer: string}> };

    try {
      const jsonMatch = extractionResult?.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        extractedData = JSON.parse(jsonMatch[0]);
        console.log('[API] JSON estratto, domande:', extractedData.questions?.length || 0);
      } else {
        throw new Error('Nessun JSON trovato');
      }
    } catch (parseError) {
      console.error('[API] Errore parsing JSON, uso fallback');
      extractedData = {
        studentName: '',
        questions: [{ 
          number: 1, 
          text: 'Testo estratto dalla verifica', 
          studentAnswer: extractionResult || 'Nessun testo riconosciuto'
        }]
      };
    }

    if (!extractedData.questions || extractedData.questions.length === 0) {
      return res.status(400).json({
        error: 'Non sono riuscito a identificare domande nella verifica.'
      });
    }

    // Step 2: Evaluate using LLM
    console.log('[API] Step 2: Valutazione con LLM...');
    
    const subjectInstructions = getSubjectInstructions(subject);
    const testTypeInstructions = getTestTypeInstructions(testType);
    const questionsPerScore = maxScore / extractedData.questions.length;
    
    const evaluationPrompt = `Sei un insegnante italiano esperto di ${subject}. Valuta questa verifica.

CRITERI:
${subjectInstructions}
${testTypeInstructions}

Punteggio per domanda: ${questionsPerScore.toFixed(1)} punti.

DOMANDE E RISPOSTE:
${extractedData.questions.map((q) => `DOMANDA ${q.number}: ${q.text}\nRISPOSTA: ${q.studentAnswer || '[nessuna]'}`).join('\n\n')}

Rispondi in JSON:
{"questions":[{"number":1,"score":2.0,"correctAnswer":"risposta","feedback":"commento","isCorrect":true}],"overallFeedback":"commento generale"}`;

    let evaluationResponse;
    try {
      evaluationResponse = await zai.chat.completions.create({
        messages: [
          { role: 'system', content: 'Sei un insegnante italiano. Rispondi solo in JSON.' },
          { role: 'user', content: evaluationPrompt }
        ],
        temperature: 0.3
      });
      console.log('[API] LLM risposta ricevuta');
    } catch (llmError) {
      console.error('[API] Errore LLM:', llmError);
      return res.status(500).json({ 
        error: 'Errore nella valutazione.',
        details: llmError instanceof Error ? llmError.message : String(llmError)
      });
    }

    const evaluationResult = evaluationResponse.choices?.[0]?.message?.content;
    
    let evaluation: { 
      questions: Array<{number: number; score: number; correctAnswer: string; feedback: string; isCorrect: boolean}>;
      overallFeedback: string;
    };

    try {
      const jsonMatch = evaluationResult?.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        evaluation = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON');
      }
    } catch {
      evaluation = {
        questions: extractedData.questions.map((q) => ({
          number: q.number,
          score: questionsPerScore / 2,
          correctAnswer: '',
          feedback: 'Valutazione automatica',
          isCorrect: false
        })),
        overallFeedback: 'Valutazione completata.'
      };
    }

    // Build result
    const finalQuestions: Question[] = extractedData.questions.map((q, index) => {
      const evalQ = evaluation.questions?.find((eq) => eq.number === q.number) || evaluation.questions?.[index];
      
      return {
        id: `q-${q.number}-${Date.now()}`,
        number: q.number,
        text: q.text,
        studentAnswer: q.studentAnswer || '',
        correctAnswer: evalQ?.correctAnswer || '',
        score: Math.min(Math.max(0, evalQ?.score || questionsPerScore / 2), questionsPerScore),
        maxScore: questionsPerScore,
        feedback: evalQ?.feedback || 'Nessun feedback',
        isCorrect: evalQ?.isCorrect ?? ((evalQ?.score || 0) >= questionsPerScore * 0.6),
        confirmed: null
      };
    });

    const totalScore = finalQuestions.reduce((sum, q) => sum + q.score, 0);
    const percentage = (totalScore / maxScore) * 100;

    const result: CorrectionResult = {
      studentName: extractedData.studentName || '',
      subject: subject.charAt(0).toUpperCase() + subject.slice(1),
      totalScore: Math.round(totalScore * 10) / 10,
      maxScore,
      percentage: Math.round(percentage * 10) / 10,
      grade: calculateGrade(percentage),
      questions: finalQuestions,
      overallFeedback: evaluation.overallFeedback || 'Valutazione completata.'
    };

    console.log('[API] Analisi completata con successo!');
    res.json({ result });

  } catch (error) {
    console.error('[API] Errore:', error);
    res.status(500).json({
      error: 'Errore durante l\'analisi.',
      message: error instanceof Error ? error.message : 'Errore sconosciuto'
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server avviato sulla porta ${PORT}`);
  console.log(`📍 Health: http://localhost:${PORT}/health`);
  console.log(`🔍 Debug: http://localhost:${PORT}/debug`);
  
  // Log environment status at startup
  console.log(`🔑 ZAI_API_KEY presente: ${!!process.env.ZAI_API_KEY}`);
  console.log(`🌐 ZAI_API_BASE_URL: ${process.env.ZAI_API_BASE_URL || 'non specificato'}`);
});
