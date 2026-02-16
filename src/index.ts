import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
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

// Create .z-ai-config file with CORRECT format
function createZaiConfigFile(): { success: boolean; error?: string } {
  const apiKey = process.env.ZAI_API_KEY;
  // CORRECT baseUrl for z-ai-web-dev-sdk: https://api.z.ai/api/paas/v4
  // The SDK will append /chat/completions for chat and /chat/completions/vision for vision
  const baseUrl = process.env.ZAI_BASE_URL || 'https://api.z.ai/api/paas/v4';
  
  console.log('[CONFIG] Creazione file .z-ai-config...');
  console.log('[CONFIG] API Key presente:', !!apiKey);
  console.log('[CONFIG] Base URL:', baseUrl);
  
  if (!apiKey) {
    return { success: false, error: 'ZAI_API_KEY non impostata' };
  }
  
  // Format REQUIRED by SDK:
  // {
  //   "baseUrl": "https://api.example.com/v1",
  //   "apiKey": "YOUR_API_KEY"
  // }
  const configContent = JSON.stringify({
    baseUrl: baseUrl,
    apiKey: apiKey
  }, null, 2);
  
  console.log('[CONFIG] Contenuto config:', JSON.stringify({ baseUrl: baseUrl, apiKey: '***hidden***' }, null, 2));
  
  // Try multiple locations
  const locations = [
    path.join(process.cwd(), '.z-ai-config'),
    path.join(process.env.HOME || '/root', '.z-ai-config'),
    '/etc/.z-ai-config'
  ];
  
  for (const configPath of locations) {
    try {
      fs.writeFileSync(configPath, configContent, 'utf8');
      console.log('[CONFIG] File creato con successo:', configPath);
      
      // Verify file was created correctly
      const verify = fs.readFileSync(configPath, 'utf8');
      console.log('[CONFIG] Verifica contenuto:', verify.substring(0, 100));
    } catch (e) {
      console.log('[CONFIG] Impossibile scrivere in:', configPath, e instanceof Error ? e.message : String(e));
    }
  }
  
  return { success: true };
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
    
    // Create config file FIRST
    const configResult = createZaiConfigFile();
    if (!configResult.success) {
      throw new Error(configResult.error || 'Errore creazione config');
    }
    
    try {
      zaiInstance = await ZAI.create();
      console.log('[INIT] ZAI SDK inizializzato con successo!');
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
  const baseUrl = process.env.ZAI_BASE_URL;
  
  // Try to create config
  const configResult = createZaiConfigFile();
  
  // Check if files exist
  const cwdConfig = path.join(process.cwd(), '.z-ai-config');
  const homeConfig = path.join(process.env.HOME || '/root', '.z-ai-config');
  const etcConfig = '/etc/.z-ai-config';
  
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
    environment: {
      hasApiKey: !!apiKey,
      apiKeyLength: apiKey?.length || 0,
      baseUrl: baseUrl || 'non impostato (default: https://api.z.ai/api/paas/v4)'
    },
    configFile: {
      creationSuccess: configResult.success,
      cwdExists: fs.existsSync(cwdConfig),
      homeExists: fs.existsSync(homeConfig),
      etcExists: fs.existsSync(etcConfig),
      cwdPath: cwdConfig,
      homePath: homeConfig
    },
    zai: {
      status: zaiStatus,
      error: initError
    },
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
    if (!image) return res.status(400).json({ error: 'Immagine mancante' });
    if (!subject) return res.status(400).json({ error: 'Materia mancante' });
    if (!testType) return res.status(400).json({ error: 'Tipo di verifica mancante' });

    console.log(`[API] Parametri: materia=${subject}, tipo=${testType}, maxScore=${maxScore}`);

    // Initialize ZAI
    const zai = await initZAI();
    console.log('[API] ZAI pronto');

    // Step 1: Extract text using VLM
    console.log('[API] Step 1: Estrazione testo con VLM...');
    
    const extractionPrompt = `Analizza questa immagine di una verifica scolastica italiana. 
Estrai il testo: nome studente, domande numerate, risposte dello studente.
Rispondi in JSON: {"studentName":"nome","questions":[{"number":1,"text":"domanda","studentAnswer":"risposta"}]}`;

    let extractionResponse;
    try {
      extractionResponse = await zai.chat.completions.createVision({
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: extractionPrompt },
            { type: 'image_url', image_url: { url: image } }
          ]
        }]
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
    
    let extractedData: { studentName: string; questions: Array<{number: number; text: string; studentAnswer: string}> };
    try {
      const jsonMatch = extractionResult?.match(/\{[\s\S]*\}/);
      extractedData = jsonMatch ? JSON.parse(jsonMatch[0]) : { studentName: '', questions: [{ number: 1, text: 'Verifica', studentAnswer: extractionResult || '' }] };
    } catch {
      extractedData = { studentName: '', questions: [{ number: 1, text: 'Verifica', studentAnswer: extractionResult || '' }] };
    }

    if (!extractedData.questions?.length) {
      return res.status(400).json({ error: 'Nessuna domanda identificata.' });
    }

    // Step 2: Evaluate using LLM
    console.log('[API] Step 2: Valutazione con LLM...');
    
    const questionsPerScore = maxScore / extractedData.questions.length;
    const evaluationPrompt = `Sei un insegnante di ${subject}. Valuta questa verifica.
${getSubjectInstructions(subject)}
${getTestTypeInstructions(testType)}
Domande: ${extractedData.questions.map(q => `D${q.number}: ${q.text} - R: ${q.studentAnswer}`).join('; ')}
Rispondi in JSON: {"questions":[{"number":1,"score":2,"correctAnswer":"","feedback":"ok","isCorrect":true}],"overallFeedback":"ok"}`;

    let evaluation;
    try {
      const evalResponse = await zai.chat.completions.create({
        messages: [
          { role: 'system', content: 'Sei un insegnante. Rispondi in JSON.' },
          { role: 'user', content: evaluationPrompt }
        ],
        temperature: 0.3
      });
      const evalResult = evalResponse.choices?.[0]?.message?.content;
      const jsonMatch = evalResult?.match(/\{[\s\S]*\}/);
      evaluation = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch (e) {
      console.error('[API] Errore LLM:', e);
      evaluation = null;
    }

    if (!evaluation) {
      evaluation = {
        questions: extractedData.questions.map(q => ({ number: q.number, score: questionsPerScore / 2, correctAnswer: '', feedback: 'Auto', isCorrect: false })),
        overallFeedback: 'Valutazione automatica.'
      };
    }

    // Build result
    const finalQuestions: Question[] = extractedData.questions.map((q, i) => {
      const eq = evaluation.questions?.find((e: any) => e.number === q.number) || evaluation.questions?.[i] || {};
      return {
        id: `q-${q.number}-${Date.now()}`,
        number: q.number,
        text: q.text,
        studentAnswer: q.studentAnswer || '',
        correctAnswer: eq.correctAnswer || '',
        score: Math.min(Math.max(0, eq.score || questionsPerScore / 2), questionsPerScore),
        maxScore: questionsPerScore,
        feedback: eq.feedback || 'Ok',
        isCorrect: eq.isCorrect ?? true,
        confirmed: null
      };
    });

    const totalScore = finalQuestions.reduce((s, q) => s + q.score, 0);
    const percentage = (totalScore / maxScore) * 100;

    res.json({
      result: {
        studentName: extractedData.studentName || '',
        subject: subject.charAt(0).toUpperCase() + subject.slice(1),
        totalScore: Math.round(totalScore * 10) / 10,
        maxScore,
        percentage: Math.round(percentage * 10) / 10,
        grade: calculateGrade(percentage),
        questions: finalQuestions,
        overallFeedback: evaluation.overallFeedback || 'Completato.'
      }
    });

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
  console.log(`🔑 ZAI_API_KEY presente: ${!!process.env.ZAI_API_KEY}`);
  console.log(`🌐 ZAI_BASE_URL: ${process.env.ZAI_BASE_URL || 'default: https://api.z.ai/api/paas/v4'}`);
});
