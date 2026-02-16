import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';

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

// API Configuration - Get from environment variables
function getApiConfig() {
  const apiKey = process.env.ZAI_API_KEY;
  const baseUrl = process.env.ZAI_BASE_URL || 'https://api.z.ai/api/paas/v4';
  
  console.log('[CONFIG] API Key presente:', !!apiKey);
  console.log('[CONFIG] Base URL:', baseUrl);
  
  return { apiKey, baseUrl };
}

// Direct HTTP call to chat completions API
async function callChatAPI(messages: any[], temperature: number = 0.7): Promise<any> {
  const { apiKey, baseUrl } = getApiConfig();
  
  if (!apiKey) {
    throw new Error('ZAI_API_KEY non configurata');
  }
  
  // Build the full URL - try different endpoints
  const endpoints = [
    `${baseUrl}/chat/completions`,
    `${baseUrl}/v4/chat/completions`,
  ];
  
  console.log('[API] Tentativo chiamata chat...');
  
  const requestBody = {
    messages,
    temperature,
    max_tokens: 4096
  };
  
  for (const endpoint of endpoints) {
    console.log('[API] Provando endpoint:', endpoint);
    
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
      });
      
      if (response.ok) {
        console.log('[API] ✓ Endpoint funzionante:', endpoint);
        return await response.json();
      } else if (response.status === 401) {
        const errorText = await response.text();
        console.log('[API] ✗ Auth error (endpoint esiste):', endpoint);
        throw new Error(`Errore autenticazione: ${errorText}`);
      } else if (response.status === 404) {
        console.log('[API] ✗ Endpoint non trovato:', endpoint);
        continue;
      } else {
        console.log('[API] ✗ Errore:', response.status, endpoint);
        continue;
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('autenticazione')) {
        throw error;
      }
      console.log('[API] ✗ Errore connessione:', endpoint, error);
      continue;
    }
  }
  
  throw new Error('Nessun endpoint disponibile. Verifica ZAI_BASE_URL');
}

// Direct HTTP call for vision - sends image with chat completion
async function callVisionAPI(imageUrl: string, prompt: string): Promise<any> {
  const { apiKey, baseUrl } = getApiConfig();
  
  if (!apiKey) {
    throw new Error('ZAI_API_KEY non configurata');
  }
  
  // Build message with image
  const messages = [{
    role: 'user',
    content: [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: imageUrl } }
    ]
  }];
  
  // Try different endpoint variations
  const endpoints = [
    `${baseUrl}/chat/completions`,
    `${baseUrl}/v4/chat/completions`,
    `${baseUrl}/chat/completions/vision`,
    `${baseUrl}/v4/chat/completions/vision`,
  ];
  
  console.log('[VISION] Tentativo analisi immagine...');
  
  const requestBody = {
    messages,
    max_tokens: 4096
  };
  
  for (const endpoint of endpoints) {
    console.log('[VISION] Provando endpoint:', endpoint);
    
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
      });
      
      if (response.ok) {
        console.log('[VISION] ✓ Endpoint funzionante:', endpoint);
        return await response.json();
      } else if (response.status === 401) {
        const errorText = await response.text();
        console.log('[VISION] ✗ Auth error (endpoint esiste, verifica API key)');
        throw new Error(`Errore autenticazione - verifica ZAI_API_KEY: ${errorText.substring(0, 200)}`);
      } else if (response.status === 404) {
        console.log('[VISION] ✗ Endpoint non trovato:', endpoint);
        continue;
      } else {
        const errorText = await response.text();
        console.log('[VISION] ✗ Errore:', response.status, errorText.substring(0, 100));
        continue;
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('autenticazione')) {
        throw error;
      }
      console.log('[VISION] ✗ Errore:', endpoint, error);
      continue;
    }
  }
  
  throw new Error('Nessun endpoint vision disponibile. Verifica che la tua API supporti analisi immagini.');
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

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Debug endpoint - test API connection
app.get('/debug', async (req, res) => {
  const { apiKey, baseUrl } = getApiConfig();
  
  let testResults: any[] = [];
  
  // Test different endpoints
  const endpoints = [
    `${baseUrl}/chat/completions`,
    `${baseUrl}/v4/chat/completions`,
    `${baseUrl}/chat/completions/vision`,
    `${baseUrl}/v4/chat/completions/vision`,
  ];
  
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey || 'test'}`
        },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'test' }] })
      });
      
      testResults.push({
        endpoint,
        status: response.status,
        working: response.status !== 404
      });
    } catch (error) {
      testResults.push({
        endpoint,
        status: 'error',
        working: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  
  res.json({
    config: {
      hasApiKey: !!apiKey,
      apiKeyLength: apiKey?.length || 0,
      baseUrl
    },
    endpointTests: testResults,
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

    // Step 1: Extract text using Vision API
    console.log('[API] Step 1: Estrazione testo con Vision...');
    
    const extractionPrompt = `Analizza questa immagine di una verifica scolastica italiana. 
Estrai il testo: nome studente, domande numerate, risposte dello studente.
Rispondi SOLO in formato JSON senza markdown:
{"studentName":"nome","questions":[{"number":1,"text":"domanda","studentAnswer":"risposta"}]}`;

    let extractionResponse;
    try {
      extractionResponse = await callVisionAPI(image, extractionPrompt);
      console.log('[API] Vision risposta ricevuta');
    } catch (visionError) {
      console.error('[API] Errore Vision:', visionError);
      return res.status(500).json({ 
        error: 'Errore nell\'analisi dell\'immagine.',
        details: visionError instanceof Error ? visionError.message : String(visionError)
      });
    }

    const extractionResult = extractionResponse.choices?.[0]?.message?.content;
    console.log('[API] Risposta Vision:', extractionResult?.substring(0, 200));
    
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

    // Step 2: Evaluate using Chat API
    console.log('[API] Step 2: Valutazione con LLM...');
    
    const questionsPerScore = maxScore / extractedData.questions.length;
    const evaluationPrompt = `Sei un insegnante di ${subject}. Valuta questa verifica.
${getSubjectInstructions(subject)}
${getTestTypeInstructions(testType)}

Domande dello studente:
${extractedData.questions.map(q => `Domanda ${q.number}: ${q.text}\nRisposta: ${q.studentAnswer}`).join('\n\n')}

Per ogni domanda, assegna un punteggio da 0 a ${questionsPerScore.toFixed(1)} e fornisci un feedback breve.
Rispondi SOLO in formato JSON senza markdown:
{"questions":[{"number":1,"score":punteggio,"correctAnswer":"risposta corretta se diversa","feedback":"feedback breve","isCorrect":true/false}],"overallFeedback":"commento generale"}`;

    let evaluation;
    try {
      const evalResponse = await callChatAPI([
        { role: 'system', content: 'Sei un insegnante esperto. Rispondi sempre in formato JSON valido.' },
        { role: 'user', content: evaluationPrompt }
      ], 0.3);
      
      const evalResult = evalResponse.choices?.[0]?.message?.content;
      const jsonMatch = evalResult?.match(/\{[\s\S]*\}/);
      evaluation = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch (e) {
      console.error('[API] Errore LLM:', e);
      evaluation = null;
    }

    if (!evaluation) {
      evaluation = {
        questions: extractedData.questions.map(q => ({ 
          number: q.number, 
          score: questionsPerScore / 2, 
          correctAnswer: '', 
          feedback: 'Valutazione automatica', 
          isCorrect: false 
        })),
        overallFeedback: 'Valutazione automatica generata.'
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
