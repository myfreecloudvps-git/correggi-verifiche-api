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
    zaiInstance = await ZAI.create();
  }
  return zaiInstance;
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Main analysis endpoint
app.post('/api/analyze', async (req, res) => {
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
Estrai TUTTO il testo presente nell'immagine:
- Nome dello studente se presente
- Domande numerate
- Risposte dello studente

Rispondi in JSON:
{
  "studentName": "nome o stringa vuota",
  "questions": [{"number": 1, "text": "domanda", "studentAnswer": "risposta"}]
}`;

    const extractionResponse = await zai.chat.completions.createVision({
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

    const extractionResult = extractionResponse.choices[0]?.message?.content;
    let extractedData: { studentName: string; questions: Array<{number: number; text: string; studentAnswer: string}> };

    try {
      const jsonMatch = extractionResult?.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        extractedData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Nessun JSON trovato');
      }
    } catch {
      extractedData = {
        studentName: '',
        questions: [{ number: 1, text: 'Domanda estratta', studentAnswer: extractionResult || '' }]
      };
    }

    if (!extractedData.questions || extractedData.questions.length === 0) {
      return res.status(400).json({
        error: 'Non sono riuscito a identificare domande nella verifica.'
      });
    }

    // Step 2: Evaluate using LLM
    const subjectInstructions = getSubjectInstructions(subject);
    const testTypeInstructions = getTestTypeInstructions(testType);
    const questionsPerScore = maxScore / extractedData.questions.length;
    
    const evaluationPrompt = `Sei un insegnante di ${subject}. Valuta questa verifica.

${subjectInstructions}
${testTypeInstructions}

DOMANDE E RISPOSTE:
${extractedData.questions.map((q) => `DOMANDA ${q.number}: ${q.text}\nRISPOSTA: ${q.studentAnswer || '[nessuna]'}`).join('\n\n')}

Assegna punteggi (max ${questionsPerScore.toFixed(1)} per domanda) e fornisci feedback.
Rispondi in JSON:
{"questions":[{"number":1,"score":2.5,"correctAnswer":"risposta","feedback":"commento","isCorrect":true}],"overallFeedback":"feedback generale"}`;

    const evaluationResponse = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: 'Sei un insegnante italiano. Rispondi in JSON.' },
        { role: 'user', content: evaluationPrompt }
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
        throw new Error('No JSON');
      }
    } catch {
      evaluation = {
        questions: extractedData.questions.map((q) => ({
          number: q.number,
          score: questionsPerScore / 2,
          correctAnswer: '',
          feedback: 'Valutazione non disponibile',
          isCorrect: false
        })),
        overallFeedback: 'Valutazione completata.'
      };
    }

    // Build result
    const finalQuestions: Question[] = extractedData.questions.map((q, index) => {
      const evalQ = evaluation.questions?.find((eq) => eq.number === q.number) || evaluation.questions?.[index] || { score: questionsPerScore / 2, correctAnswer: '', feedback: 'Nessun feedback', isCorrect: false };
      
      return {
        id: `q-${q.number}-${Date.now()}`,
        number: q.number,
        text: q.text,
        studentAnswer: q.studentAnswer || '',
        correctAnswer: evalQ.correctAnswer || '',
        score: Math.min(Math.max(0, evalQ.score || 0), questionsPerScore),
        maxScore: questionsPerScore,
        feedback: evalQ.feedback || 'Nessun feedback',
        isCorrect: evalQ.isCorrect ?? (evalQ.score >= questionsPerScore * 0.6),
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
      error: 'Errore durante l\'analisi. Riprova.'
    });
  }
});

// Error handling
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Errore interno del server' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server avviato sulla porta ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
});
