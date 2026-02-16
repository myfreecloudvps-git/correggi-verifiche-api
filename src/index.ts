import express from 'express';
import cors from 'cors';

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
function getApiConfig() {
  const apiKey = process.env.ZAI_API_KEY;
  const baseUrl = process.env.ZAI_BASE_URL || 'https://api.z.ai/api/paas';
  return { apiKey, baseUrl };
}

// Call the chat/completions endpoint
async function callChatAPI(messages: any[], temperature: number = 0.3): Promise<any> {
  const { apiKey, baseUrl } = getApiConfig();
  
  if (!apiKey) throw new Error('ZAI_API_KEY non configurata');
  
  const endpoint = `${baseUrl}/v4/chat/completions`;
  
  console.log('[API] Calling:', endpoint);
  
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      messages,
      temperature,
      max_tokens: 4096
    })
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API Error (${response.status}): ${errorText.substring(0, 500)}`);
  }
  
  return await response.json();
}

// Vision call - same endpoint with image content
async function callVisionAPI(imageUrl: string, prompt: string): Promise<any> {
  const { apiKey, baseUrl } = getApiConfig();
  
  if (!apiKey) throw new Error('ZAI_API_KEY non configurata');
  
  const endpoint = `${baseUrl}/v4/chat/completions`;
  
  console.log('[VISION] Calling:', endpoint);
  console.log('[VISION] Image type:', imageUrl?.substring(0, 30));
  console.log('[VISION] Image length:', imageUrl?.length || 0);
  
  const messages = [{
    role: 'user',
    content: [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: imageUrl } }
    ]
  }];
  
  const requestBody = {
    messages,
    max_tokens: 4096
  };
  
  console.log('[VISION] Sending request...');
  
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody)
  });
  
  const responseText = await response.text();
  console.log('[VISION] Response status:', response.status);
  console.log('[VISION] Response body (first 500 chars):', responseText.substring(0, 500));
  
  if (!response.ok) {
    throw new Error(`Vision API Error (${response.status}): ${responseText.substring(0, 500)}`);
  }
  
  try {
    const result = JSON.parse(responseText);
    console.log('[VISION] Parsed successfully');
    console.log('[VISION] Has choices:', !!result.choices);
    console.log('[VISION] Has message:', !!result.choices?.[0]?.message);
    console.log('[VISION] Content length:', result.choices?.[0]?.message?.content?.length || 0);
    return result;
  } catch (parseError) {
    console.error('[VISION] Parse error:', parseError);
    throw new Error(`Failed to parse API response: ${responseText.substring(0, 200)}`);
  }
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
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json({ limit: '50mb' }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Debug endpoint
app.get('/debug', async (req, res) => {
  const { apiKey, baseUrl } = getApiConfig();
  
  let chatWorks = false;
  let visionWorks = false;
  let chatError = null;
  let visionError = null;
  
  // Test chat
  try {
    const response = await fetch(`${baseUrl}/v4/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Rispondi solo: ok' }],
        max_tokens: 10
      })
    });
    chatWorks = response.ok;
    if (!response.ok) chatError = `Status ${response.status}`;
  } catch (e) {
    chatError = e instanceof Error ? e.message : String(e);
  }
  
  // Test vision with tiny image
  const testImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  try {
    const response = await fetch(`${baseUrl}/v4/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Rispondi solo: ok' },
            { type: 'image_url', image_url: { url: testImage } }
          ]
        }],
        max_tokens: 10
      })
    });
    visionWorks = response.ok;
    if (!response.ok) visionError = `Status ${response.status}`;
  } catch (e) {
    visionError = e instanceof Error ? e.message : String(e);
  }
  
  res.json({
    config: { hasApiKey: !!apiKey, apiKeyLength: apiKey?.length || 0, baseUrl },
    chat: { works: chatWorks, error: chatError },
    vision: { works: visionWorks, error: visionError },
    recommendation: visionWorks 
      ? "✅ Tutto funzionante!" 
      : chatWorks 
        ? "⚠️ Chat funziona ma Vision no - verifica che l'API supporti immagini"
        : "❌ Né chat né vision funzionano - verifica API key e URL",
    timestamp: new Date().toISOString()
  });
});

// Test endpoint - returns raw AI response for debugging
app.post('/api/test-vision', async (req, res) => {
  const { apiKey, baseUrl } = getApiConfig();
  
  try {
    const { image } = req.body;
    
    if (!image) {
      return res.status(400).json({ error: 'Immagine mancante' });
    }
    
    console.log('[TEST] ========================================');
    console.log('[TEST] Testing vision with image...');
    console.log('[TEST] Image length:', image?.length || 0);
    console.log('[TEST] Image starts with:', image?.substring(0, 50));
    
    const prompt = `Guarda questa immagine e descrivi esattamente cosa vedi.
Elenca:
1. Il tipo di documento (verifica, test, esercizio)
2. Tutte le domande che riesci a leggere (numerate)
3. Le risposte fornite dallo studente
4. Il nome dello studente se presente

Rispondi in italiano in modo dettagliato.`;

    const endpoint = `${baseUrl}/v4/chat/completions`;
    
    const requestBody = {
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: image } }
        ]
      }],
      max_tokens: 4096
    };
    
    console.log('[TEST] Calling:', endpoint);
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });
    
    const responseText = await response.text();
    console.log('[TEST] Response status:', response.status);
    console.log('[TEST] Response body (first 1000 chars):', responseText.substring(0, 1000));
    
    if (!response.ok) {
      return res.json({
        success: false,
        error: `API Error (${response.status})`,
        details: responseText.substring(0, 1000),
        endpoint: endpoint
      });
    }
    
    let result;
    try {
      result = JSON.parse(responseText);
    } catch (e) {
      return res.json({
        success: false,
        error: 'Failed to parse JSON response',
        rawResponse: responseText.substring(0, 1000)
      });
    }
    
    const content = result.choices?.[0]?.message?.content;
    console.log('[TEST] Content length:', content?.length || 0);
    console.log('[TEST] Content preview:', content?.substring(0, 300));
    console.log('[TEST] ========================================');
    
    res.json({
      success: true,
      rawResponse: content,
      responseLength: content?.length || 0,
      fullResult: result
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

    console.log(`[ANALYZE] Materia: ${subject}, Tipo: ${testType}, MaxScore: ${maxScore}`);

    // SINGLE comprehensive prompt - extracts AND evaluates in one shot
    const analysisPrompt = `Sei un insegnante italiano esperto di ${subject}. Analizza questa immagine di una verifica scolastica.

ISTRUZIONI IMPORTANTI:
1. Guarda attentamente l'immagine
2. Identifica TUTTE le domande presenti (possono essere Vero/Falso, a risposta multipla, o aperte)
3. Per ogni domanda, leggi la risposta data dallo studente
4. Valuta se la risposta è corretta o no
5. Il punteggio massimo totale è ${maxScore} punti

TIPO DI VERIFICA: ${testType}

Rispondi ESCLUSIVAMENTE con un JSON valido in questo formato esatto:
{
  "studentName": "nome dello studente o stringa vuota",
  "totalQuestions": numero totale di domande trovate,
  "questions": [
    {
      "number": 1,
      "text": "testo completo della domanda",
      "type": "vero_falso o multipla o aperta",
      "studentAnswer": "risposta data dallo studente",
      "correctAnswer": "risposta corretta",
      "isCorrect": true o false,
      "score": punti assegnati (calcolati proporzionalmente: ${maxScore} / numero domande),
      "feedback": "feedback breve per lo studente"
    }
  ],
  "overallFeedback": "commento generale sulla verifica",
  "totalScore": punteggio totale assegnato
}

IMPORTANTE: 
- Identifica TUTTE le domande, non solo una
- Per i Vero/Falso, la risposta dello studente sarà "V" o "F" o "Vero" o "Falso"
- Assegna punti in modo proporzionale
- Se non riesci a leggere qualcosa, indicarlo nel feedback

Analizza ora l'immagine e rispondi SOLO con il JSON.`;

    let response;
    try {
      response = await callVisionAPI(image, analysisPrompt);
    } catch (visionError) {
      console.error('[ANALYZE] Vision error:', visionError);
      return res.status(500).json({ 
        error: 'Errore nell\'analisi dell\'immagine',
        details: visionError instanceof Error ? visionError.message : String(visionError)
      });
    }

    const rawContent = response.choices?.[0]?.message?.content;
    console.log('[ANALYZE] Raw AI response (first 1000 chars):');
    console.log(rawContent?.substring(0, 1000));
    console.log('[ANALYZE] ========================================');
    
    if (!rawContent) {
      return res.status(500).json({ error: 'Nessuna risposta dall\'IA' });
    }

    // Parse JSON from response
    let analysisResult: any;
    try {
      // Try to extract JSON from the response
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Nessun JSON trovato nella risposta');
      }
    } catch (parseError) {
      console.error('[ANALYZE] JSON parse error:', parseError);
      console.error('[ANALYZE] Response was:', rawContent);
      return res.status(500).json({ 
        error: 'Errore nel parsing della risposta AI',
        rawResponse: rawContent.substring(0, 1000)
      });
    }

    // Validate and build final result
    if (!analysisResult.questions || !Array.isArray(analysisResult.questions)) {
      console.error('[ANALYZE] Invalid structure:', analysisResult);
      return res.status(500).json({ 
        error: 'Struttura risposta non valida',
        received: analysisResult
      });
    }

    console.log(`[ANALYZE] Found ${analysisResult.questions.length} questions`);

    // Build final questions array
    const questionsPerScore = maxScore / (analysisResult.totalQuestions || analysisResult.questions.length || 1);
    
    const finalQuestions: Question[] = analysisResult.questions.map((q: any, index: number) => {
      const score = typeof q.score === 'number' ? q.score : (q.isCorrect ? questionsPerScore : 0);
      
      return {
        id: `q-${q.number || index + 1}-${Date.now()}`,
        number: q.number || index + 1,
        text: q.text || `Domanda ${q.number || index + 1}`,
        studentAnswer: q.studentAnswer || '',
        correctAnswer: q.correctAnswer || '',
        score: Math.min(Math.max(0, score), questionsPerScore),
        maxScore: questionsPerScore,
        feedback: q.feedback || (q.isCorrect ? 'Corretto' : 'Non corretto'),
        isCorrect: q.isCorrect ?? false,
        confirmed: null
      };
    });

    // Calculate totals
    const totalScore = analysisResult.totalScore || finalQuestions.reduce((sum, q) => sum + q.score, 0);
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

    console.log(`[ANALYZE] Result: ${finalQuestions.length} questions, score ${totalScore}/${maxScore} (${percentage.toFixed(1)}%)`);

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
  console.log(`🚀 Server avviato sulla porta ${PORT}`);
  console.log(`📍 Health: http://localhost:${PORT}/health`);
  console.log(`🔍 Debug: http://localhost:${PORT}/debug`);
  console.log(`🔑 ZAI_API_KEY: ${!!process.env.ZAI_API_KEY ? 'presente' : 'MANCANTE'}`);
  console.log(`🌐 ZAI_BASE_URL: ${process.env.ZAI_BASE_URL || 'default: https://api.z.ai/api/paas'}`);
});
