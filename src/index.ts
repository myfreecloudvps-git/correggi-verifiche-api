import express, { Request, Response, NextFunction } from 'express';
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

// Vision message content types
interface TextContent {
  type: 'text';
  text: string;
}

interface ImageUrlContent {
  type: 'image_url';
  image_url: {
    url: string;
  };
}

type VisionContent = TextContent | ImageUrlContent;

interface VisionMessage {
  role: 'user' | 'assistant' | 'system';
  content: VisionContent[];
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
    'italiano': 'Valuta la correttezza grammaticale, la sintassi, l\'ortografia e la qualità espositiva. Considera la coerenza logica e la proprietà di linguaggio.',
    'matematica': 'Valuta la correttezza dei calcoli, la logica di risoluzione, l\'applicazione delle formule e la chiarezza nell\'esposizione del procedimento.',
    'storia': 'Valuta la conoscenza degli eventi storici, la capacità di contestualizzazione, l\'analisi cause-effetti e l\'uso del lessico specifico.',
    'geografia': 'Valuta la conoscenza geografica, la capacità di localizzazione, l\'analisi territoriale e l\'uso di terminologia appropriata.',
    'scienze': 'Valuta la conoscenza scientifica, la comprensione dei fenomeni, la capacità di osservazione e l\'uso del metodo scientifico.',
    'inglese': 'Valuta la correttezza grammaticale, il vocabolario, la pronuncia (se applicabile) e la comprensione del testo.',
  };
  return instructions[subject] || 'Valuta la correttezza delle risposte e la comprensione degli argomenti trattati.';
}

// Get test type instructions
function getTestTypeInstructions(testType: string): string {
  const instructions: Record<string, string> = {
    'aperte': 'Le domande sono a risposta aperta. Valuta la completezza, l\'accuratezza e la qualità dell\'esposizione.',
    'chiuse': 'Le domande sono a risposta chiusa (multiple choice, vero/falso). Valuta la correttezza della risposta scelta.',
    'miste': 'La verifica contiene sia domande a risposta aperta che chiusa. Adatta la valutazione in base al tipo di domanda.',
    'dettato': 'Si tratta di un dettato ortografico. Valuta principalmente la correttezza ortografica e la punteggiatura.',
    'problemi': 'Si tratta di problemi matematici. Valuta il procedimento risolutivo, i calcoli e la risposta finale.',
    'comprensione': 'Si tratta di una comprensione del testo. Valuta la capacità di comprendere e interpretare il testo.',
    'riassunto': 'Si tratta di un riassunto. Valuta la capacità di sintetizzare, mantenere le informazioni essenziali e la qualità espositiva.',
  };
  return instructions[testType] || 'Valuta le risposte in base al tipo di verifica.';
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
    zaiInstance = await ZAI.create();
  }
  return zaiInstance;
}

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Main analysis endpoint
app.post('/api/analyze', async (req: Request, res: Response) => {
  try {
    const body: AnalysisRequest = req.body;
    const { image, subject, testType, customInstructions, maxScore } = body;

    if (!image || !subject || !testType) {
      return res.status(400).json({
        error: 'Immagine, materia e tipo di verifica sono obbligatori'
      });
    }

    // Initialize ZAI
    const zai = await initZAI();

    // Step 1: Extract text from image using VLM
    const extractionPrompt = `Analizza questa immagine di una verifica scolastica. 
Estrai TUTTO il testo presente nell'immagine, incluse:
- Il nome dello studente se presente
- Le domande numerate
- Le risposte scritte dallo studente
- Qualsiasi altro testo presente

Rispondi in formato JSON con questa struttura:
{
  "studentName": "nome dello studente o stringa vuota se non presente",
  "questions": [
    {
      "number": 1,
      "text": "testo della domanda",
      "studentAnswer": "risposta scritta dallo studente"
    }
  ]
}

Se non riesci a leggere qualcosa, scrivi "[illeggibile]". 
Se l'immagine non sembra una verifica scolastica, rispondi con un messaggio di errore.`;

    // Build vision message content with explicit typing
    const visionContent: VisionContent[] = [
      { type: 'text', text: extractionPrompt },
      { type: 'image_url', image_url: { url: image } }
    ];

    const extractionResponse = await zai.chat.completions.createVision({
      messages: [
        {
          role: 'user',
          content: visionContent
        }
      ]
    });

    const extractionResult = extractionResponse.choices[0]?.message?.content;
    let extractedData: { studentName: string; questions: Array<{number: number; text: string; studentAnswer: string}> };

    try {
      // Try to parse JSON from the response
      const jsonMatch = extractionResult?.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        extractedData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Nessun JSON trovato nella risposta');
      }
    } catch {
      // If parsing fails, try a more lenient approach
      console.error('Failed to parse extraction result, trying alternative...');
      
      const alternativePrompt = `Questa è un'immagine di una verifica. Per favore, elenca:
1. Nome studente (se presente)
2. Tutte le domande con i loro numeri
3. Le risposte dello studente

Usa questo formato esatto:
STUDENTE: [nome o "non indicato"]
DOMANDA 1: [testo domanda]
RISPOSTA 1: [risposta studente]
DOMANDA 2: [testo domanda]
RISPOSTA 2: [risposta studente]
...`;

      // Build vision message content with explicit typing
      const altVisionContent: VisionContent[] = [
        { type: 'text', text: alternativePrompt },
        { type: 'image_url', image_url: { url: image } }
      ];

      const alternativeResponse = await zai.chat.completions.createVision({
        messages: [
          {
            role: 'user',
            content: altVisionContent
          }
        ]
      });

      const altResult = alternativeResponse.choices[0]?.message?.content || '';
      
      // Parse alternative format
      const studentMatch = altResult.match(/STUDENTE:\s*(.+)/);
      const questionMatches = altResult.matchAll(/DOMANDA\s*(\d+):\s*(.+?)(?=RISPOSTA|$)/gs);
      const answerMatches = altResult.matchAll(/RISPOSTA\s*(\d+):\s*(.+?)(?=DOMANDA|$)/gs);

      const questions: Array<{number: number; text: string; studentAnswer: string}> = [];
      const answers: Record<number, string> = {};

      for (const match of answerMatches) {
        answers[parseInt(match[1])] = match[2].trim();
      }

      for (const match of questionMatches) {
        const num = parseInt(match[1]);
        questions.push({
          number: num,
          text: match[2].trim(),
          studentAnswer: answers[num] || ''
        });
      }

      extractedData = {
        studentName: studentMatch ? studentMatch[1].trim() : '',
        questions
      };
    }

    if (!extractedData.questions || extractedData.questions.length === 0) {
      return res.status(400).json({
        error: 'Non sono riuscito a identificare domande nella verifica. Assicurati che l\'immagine sia chiara e leggibile.'
      });
    }

    // Step 2: Evaluate each question using LLM
    const subjectInstructions = getSubjectInstructions(subject);
    const testTypeInstructions = getTestTypeInstructions(testType);
    
    const questionsPerScore = maxScore / extractedData.questions.length;
    
    const evaluationPrompt = `Sei un insegnante esperto di ${subject} nella scuola italiana. Devi valutare una verifica.

ISTRUZIONI GENERALI:
${subjectInstructions}

${testTypeInstructions}

${customInstructions ? `ISTRUZIONI AGGIUNTIVE DELL'INSEGNANTE:\n${customInstructions}` : ''}

LA VERIFICA CONTIENE ${extractedData.questions.length} DOMANDE.
Punteggio massimo totale: ${maxScore} punti (circa ${questionsPerScore.toFixed(1)} punti per domanda).

DOMANDE E RISPOSTE DELLO STUDENTE:
${extractedData.questions.map((q) => `
DOMANDA ${q.number}: ${q.text}
RISPOSTA STUDENTE: ${q.studentAnswer || '[nessuna risposta]'}
`).join('\n')}

Per OGNI domanda, fornisci:
1. Il punteggio assegnato (da 0 a ${questionsPerScore.toFixed(1)})
2. La risposta corretta attesa (se applicabile)
3. Un feedback costruttivo per lo studente

Rispondi SOLO in formato JSON:
{
  "questions": [
    {
      "number": 1,
      "score": 2.5,
      "correctAnswer": "risposta corretta attesa",
      "feedback": "feedback dettagliato per lo studente",
      "isCorrect": true
    }
  ],
  "overallFeedback": "feedback generale sulla verifica"
}`;

    const evaluationResponse = await zai.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: 'Sei un insegnante italiano esperto nella valutazione delle verifiche scolastiche. Rispondi sempre in formato JSON valido.'
        },
        {
          role: 'user',
          content: evaluationPrompt
        }
      ],
      temperature: 0.3
    });

    const evaluationResult = evaluationResponse.choices[0]?.message?.content;
    let evaluation: { 
      questions: Array<{number: number; score: number; correctAnswer: string; feedback: string; isCorrect: boolean}>;
      overallFeedback: string;
    };

    try {
      const jsonMatch = evaluationResult?.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        evaluation = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Nessun JSON trovato nella valutazione');
      }
    } catch {
      console.error('Failed to parse evaluation, using defaults');
      evaluation = {
        questions: extractedData.questions.map((q) => ({
          number: q.number,
          score: questionsPerScore / 2,
          correctAnswer: '',
          feedback: 'Valutazione non disponibile',
          isCorrect: false
        })),
        overallFeedback: 'Non è stato possibile generare una valutazione dettagliata.'
      };
    }

    // Step 3: Build the final result
    const finalQuestions: Question[] = extractedData.questions.map((q, index) => {
      const evaluationQ = evaluation.questions?.find((eq) => eq.number === q.number) || evaluation.questions?.[index] || { score: questionsPerScore / 2, correctAnswer: '', feedback: 'Nessun feedback', isCorrect: false };
      
      return {
        id: `q-${q.number}-${Date.now()}`,
        number: q.number,
        text: q.text,
        studentAnswer: q.studentAnswer || '',
        correctAnswer: evaluationQ.correctAnswer || '',
        score: Math.min(Math.max(0, evaluationQ.score || 0), questionsPerScore),
        maxScore: questionsPerScore,
        feedback: evaluationQ.feedback || 'Nessun feedback disponibile',
        isCorrect: evaluationQ.isCorrect ?? (evaluationQ.score >= questionsPerScore * 0.6),
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

    res.json({ result });

  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({
      error: 'Si è verificato un errore durante l\'analisi. Riprova.'
    });
  }
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Errore interno del server'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server avviato sulla porta ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
  console.log(`🔌 API endpoint: http://localhost:${PORT}/api/analyze`);
});
