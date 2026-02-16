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

// Initialize ZAI
let zaiInstance: Awaited<ReturnType<typeof ZAI.create>> | null = null;

async function initZAI() {
  if (!zaiInstance) {
    console.log('[INIT] Inizializzazione ZAI SDK...');
    try {
      zaiInstance = await ZAI.create();
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
  try {
    const zai = await initZAI();
    res.json({ 
      status: 'ZAI initialized', 
      hasInstance: !!zai,
      timestamp: new Date().toISOString() 
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'ZAI initialization failed', 
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

// Main analysis endpoint
app.post('/api/analyze', async (req, res) => {
  console.log('[API] Ricevuta richiesta di analisi');
  console.log('[API] Body keys:', Object.keys(req.body));
  
  try {
    const body: AnalysisRequest = req.body;
    const { image, subject, testType, customInstructions, maxScore } = body;

    // Validate input
    if (!image) {
      console.error('[API] Errore: immagine mancante');
      return res.status(400).json({ error: 'Immagine mancante' });
    }
    if (!subject) {
      console.error('[API] Errore: materia mancante');
      return res.status(400).json({ error: 'Materia mancante' });
    }
    if (!testType) {
      console.error('[API] Errore: tipo verifica mancante');
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
        error: 'Errore nell\'analisi dell\'immagine. L\'immagine potrebbe essere troppo grande o in un formato non supportato.',
        details: vlmError instanceof Error ? vlmError.message : String(vlmError)
      });
    }

    const extractionResult = extractionResponse.choices?.[0]?.message?.content;
    console.log('[API] Risultato estrazione:', extractionResult?.substring(0, 200) + '...');
    
    let extractedData: { studentName: string; questions: Array<{number: number; text: string; studentAnswer: string}> };

    try {
      const jsonMatch = extractionResult?.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        extractedData = JSON.parse(jsonMatch[0]);
        console.log('[API] JSON estratto correttamente, domande trovate:', extractedData.questions?.length || 0);
      } else {
        throw new Error('Nessun JSON trovato nella risposta VLM');
      }
    } catch (parseError) {
      console.error('[API] Errore parsing JSON:', parseError);
      // Fallback: crea una domanda con tutto il testo estratto
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
      console.error('[API] Nessuna domanda identificata');
      return res.status(400).json({
        error: 'Non sono riuscito a identificare domande nella verifica. Assicurati che l\'immagine sia chiara e leggibile.'
      });
    }

    // Step 2: Evaluate using LLM
    console.log('[API] Step 2: Valutazione con LLM...');
    
    const subjectInstructions = getSubjectInstructions(subject);
    const testTypeInstructions = getTestTypeInstructions(testType);
    const questionsPerScore = maxScore / extractedData.questions.length;
    
    const evaluationPrompt = `Sei un insegnante italiano esperto di ${subject}. Devi valutare questa verifica scolastica.

CRITERI DI VALUTAZIONE:
${subjectInstructions}
${testTypeInstructions}

LA VERIFICA CONTIENE ${extractedData.questions.length} DOMANDE.
Punteggio per domanda: ${questionsPerScore.toFixed(1)} punti.

DOMANDE E RISPOSTE DELLO STUDENTE:
${extractedData.questions.map((q) => `
DOMANDA ${q.number}: ${q.text}
RISPOSTA DELLO STUDENTE: ${q.studentAnswer || '[nessuna risposta fornita]'
}`).join('\n')}

Per OGNI domanda fornisci:
1. Un punteggio da 0 a ${questionsPerScore.toFixed(1)}
2. La risposta corretta attesa (se applicabile)
3. Un breve feedback costruttivo

Rispondi ESCLUSIVAMENTE in formato JSON valido:
{
  "questions": [
    {
      "number": 1,
      "score": 2.0,
      "correctAnswer": "risposta corretta",
      "feedback": "feedback per lo studente",
      "isCorrect": true
    }
  ],
  "overallFeedback": "commento generale sulla verifica"
}`;

    let evaluationResponse;
    try {
      evaluationResponse = await zai.chat.completions.create({
        messages: [
          { role: 'system', content: 'Sei un insegnante italiano esperto. Rispondi SEMPRE in formato JSON valido, senza testo aggiuntivo.' },
          { role: 'user', content: evaluationPrompt }
        ],
        temperature: 0.3
      });
      console.log('[API] LLM risposta ricevuta');
    } catch (llmError) {
      console.error('[API] Errore LLM:', llmError);
      return res.status(500).json({ 
        error: 'Errore nella valutazione. Riprova.',
        details: llmError instanceof Error ? llmError.message : String(llmError)
      });
    }

    const evaluationResult = evaluationResponse.choices?.[0]?.message?.content;
    console.log('[API] Risultato valutazione:', evaluationResult?.substring(0, 200) + '...');
    
    let evaluation: { 
      questions: Array<{number: number; score: number; correctAnswer: string; feedback: string; isCorrect: boolean}>;
      overallFeedback: string;
    };

    try {
      const jsonMatch = evaluationResult?.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        evaluation = JSON.parse(jsonMatch[0]);
        console.log('[API] Valutazione JSON parsata correttamente');
      } else {
        throw new Error('Nessun JSON nella valutazione');
      }
    } catch (parseError) {
      console.error('[API] Errore parsing valutazione, uso defaults:', parseError);
      evaluation = {
        questions: extractedData.questions.map((q) => ({
          number: q.number,
          score: questionsPerScore / 2,
          correctAnswer: '',
          feedback: 'Valutazione automatica',
          isCorrect: false
        })),
        overallFeedback: 'Valutazione completata con valori di default.'
      };
    }

    // Build result
    console.log('[API] Step 3: Costruzione risultato finale...');
    
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
        feedback: evalQ?.feedback || 'Nessun feedback disponibile',
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

    console.log('[API] Risultato finale:', JSON.stringify(result).substring(0, 300) + '...');
    console.log('[API] Analisi completata con successo!');

    res.json({ result });

  } catch (error) {
    console.error('[API] Errore generico:', error);
    console.error('[API] Stack trace:', error instanceof Error ? error.stack : 'N/A');
    res.status(500).json({
      error: 'Si è verificato un errore durante l\'analisi.',
      message: error instanceof Error ? error.message : 'Errore sconosciuto',
      timestamp: new Date().toISOString()
    });
  }
});

// Error handling
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[SERVER] Errore non gestito:', err);
  console.error('[SERVER] Stack:', err.stack);
  res.status(500).json({ 
    error: 'Errore interno del server',
    message: err.message 
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server avviato sulla porta ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
  console.log(`🔍 Debug: http://localhost:${PORT}/debug`);
  console.log(`🔌 API endpoint: http://localhost:${PORT}/api/analyze`);
});
