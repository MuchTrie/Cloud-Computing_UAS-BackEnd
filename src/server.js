const express = require('express');
const dotenv = require('dotenv');
const path = require('path');
const { chatCompletion, getClientInfo } = require('./hfClient');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Health & config
app.get('/health', (req, res) => {
  const info = getClientInfo();
  res.json({ status: 'ok', ...info });
});

// Chat endpoint – accepts { message } or { prompt }
app.post('/chat', async (req, res) => {
  const message = req.body?.message || req.body?.prompt;
  if (!message) return res.status(400).json({ error: 'message (or prompt) required' });
  try {
    const result = await chatCompletion(message, req.body?.options);
    res.json(result);
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