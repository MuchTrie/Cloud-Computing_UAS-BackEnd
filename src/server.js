const express = require('express');
const dotenv = require('dotenv');
const path = require('path');
const cors = require('cors');
const { chatCompletion, chatWithHistory, getClientInfo } = require('./hfClient');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

app.use(express.json());
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:5173',
    process.env.FRONTEND_ORIGIN || ''
  ].filter(Boolean),
  methods: ['GET','POST'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.static(path.join(__dirname, 'public')));

// Health & config
app.get('/health', (req, res) => {
  const info = getClientInfo();
  res.json({ status: 'ok', ...info });
});

// In-memory session store (sederhana, tidak untuk produksi skala besar)
const sessions = new Map(); // conversationId -> { messages: [ {role, content}, ... ] }

function getSession(id) {
  if (!sessions.has(id)) sessions.set(id, { messages: [] });
  return sessions.get(id);
}

// Chat endpoint
// Mode 1 (single turn): { message }
// Mode 2 (stateful): { conversationId, message }
// Mode 3 (custom history explicit): { messages: [ {role:'user'|'assistant', content:''}, ... ] }
app.post('/chat', async (req, res) => {
  const { message, prompt, conversationId, messages, reset, options } = req.body || {};
  const userText = message || prompt;

  if (reset && conversationId) {
    sessions.delete(conversationId);
  }

  try {
    let result;
    if (Array.isArray(messages) && messages.length) {
      // custom provided history (tanpa system)
      result = await chatWithHistory(messages, options);
    } else if (conversationId) {
      if (!userText) return res.status(400).json({ error: 'message required for conversationId mode' });
      const session = getSession(conversationId);
      session.messages.push({ role: 'user', content: userText });
      result = await chatWithHistory(session.messages, options);
      // simpan balasan assistant ke history
      session.messages.push({ role: 'assistant', content: result.reply });
    } else {
      if (!userText) return res.status(400).json({ error: 'message (or prompt) required' });
      result = await chatCompletion(userText, options);
    }
    res.json({ ...result, conversationId: conversationId || null });
  } catch (error) {
    const status = error.statusCode || error.response?.status || 500;
    res.status(status).json({ error: error.message || 'chat failed' });
  }
});

// Simple demo page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  const info = getClientInfo();
  console.log('Model:', info.model, '| Base URL:', info.baseURL);
});