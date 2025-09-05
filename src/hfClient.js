const { OpenAI } = require('openai');
const dotenv = require('dotenv');

dotenv.config();

const HF_KEY = process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN || process.env.OPENAI_API_KEY;
const MODEL = process.env.HF_MODEL || 'openai/gpt-oss-2b-fireworks-ai';
const BASE_URL = process.env.HF_BASE_URL || 'https://router.huggingface.co/v1';

if (!HF_KEY) {
	console.warn('[hfClient] Missing HUGGINGFACE_API_KEY / HF_TOKEN in .env');
}

const client = new OpenAI({ apiKey: HF_KEY, baseURL: BASE_URL });

function getClientInfo() {
	return { model: MODEL, baseURL: BASE_URL, hasKey: Boolean(HF_KEY) };
}

async function chatCompletion(prompt, options = {}) {
	const {
		temperature = 0.7,
		max_tokens = 256,
		top_p = 0.95
	} = options;

	try {
		const resp = await client.chat.completions.create({
			model: MODEL,
			messages: [ { role: 'user', content: prompt } ],
			temperature,
			max_tokens,
			top_p
		});
		const choice = resp.choices?.[0];
		const text = choice?.message?.content?.trim() || '';
		return { reply: text, modelUsed: MODEL, usage: resp.usage || null };
	} catch (err) {
		if (err.response) {
			const status = err.response.status;
			if (status === 403) {
				err.message = '403 Forbidden: token tidak punya izin ke model/Inference. Cek scope token atau ganti model.';
			} else if (status === 404) {
				err.message = '404 Not Found: nama model salah atau belum tersedia di router.';
			}
		}
		throw err;
	}
}

module.exports = { chatCompletion, getClientInfo };
