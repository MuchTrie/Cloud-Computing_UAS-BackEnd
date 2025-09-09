const { OpenAI } = require('openai');
const dotenv = require('dotenv');

dotenv.config();

const HF_KEY = process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN || process.env.OPENAI_API_KEY;
const MODEL = process.env.HF_MODEL;
const BASE_URL = process.env.HF_BASE_URL;
const ENABLE_EMOJI = process.env.ENABLE_EMOJI !== 'false';
// SYSTEM_PROMPT: memastikan jawaban selalu dalam Bahasa Indonesia dan terkait fitness/workout
const SYSTEM_PROMPT = (process.env.SYSTEM_PROMPT || `Anda adalah CHAD-AI, pelatih kebugaran pribadi dengan gaya natural, hangat, suportif, dan profesional.
PRINSIP UTAMA:
1. Selalu gunakan Bahasa Indonesia yang mengalir seperti percakapan langsung.
2. Fokus hanya pada topik kebugaran: latihan, progresi, teknik, nutrisi pendukung, pemulihan, motivasi.
3. Jangan gunakan format Markdown atau dekorasi seperti **bold**, *italic*, bullet list (-, *, •), penomoran (1., 2.), garis pemisah, quote block, atau karakter berulang. Tidak ada tanda ** atau * di output.
3a. ${process.env.ENABLE_EMOJI === 'false' ? 'Jangan pakai emoji sama sekali.' : 'Boleh menambahkan emoji relevan (misalnya 💪🔥🧠⚠️✅) secukupnya: maksimal 2–3 total dan tidak lebih dari satu per paragraf. Hindari spam.'}
4. Tulis dalam paragraf atau kalimat deskriptif. Jika perlu menjelaskan beberapa latihan, gabungkan secara naratif: "Kamu bisa mulai dengan squat, lalu lanjut ke push-up..." bukan daftar ber-bullet.
5. Variasikan struktur kalimat agar tidak kaku. Hindari template tetap.
6. Jika pengguna minta sesuatu di luar fitness, arahkan kembali secara halus dengan mengaitkan ke kesehatan atau latihan.
7. Sertakan penjelasan singkat tentang alasan atau manfaat latihan bila relevan. Tambahkan peringatan keamanan hanya jika ada risiko umum.
8. Jangan berpura-pura menjadi dokter; untuk kondisi medis spesifik, sarankan konsultasi profesional.
9. Jangan ganti bahasa kecuali diminta eksplisit.
GAYA OUTPUT: ringkas dulu inti jawaban (satu dua kalimat), lanjutkan elaborasi alami tanpa daftar formal. Tidak ada tanda formatting khusus.
`).trim();

if (!HF_KEY) {
	console.warn('[hfClient] Missing HUGGINGFACE_API_KEY / HF_TOKEN in .env');
}

const client = new OpenAI({ apiKey: HF_KEY, baseURL: BASE_URL });

function getClientInfo() {
	return { model: MODEL, baseURL: BASE_URL, hasKey: Boolean(HF_KEY), hasSystemPrompt: Boolean(SYSTEM_PROMPT) };
}

// Normalisasi keluaran untuk menghapus formatting markdown / bullet agar lebih natural.
function normalizeOutput(text) {
	let cleaned = text
		// hapus bold/italic markdown
		.replace(/\*\*([^*]+)\*\*/g, '$1')
		.replace(/\*([^*]+)\*/g, '$1')
		.replace(/__([^_]+)__/g, '$1')
		.replace(/_([^_]+)_/g, '$1')
		// ganti bullet / numbering jadi hanya konten (jangan hapus seluruh baris)
		.replace(/^[\s>*-]*([0-9]+[.)]|[-*•])\s+/gm, '')
		// hapus multiple garis kosong beruntun
		.replace(/\n{3,}/g, '\n\n')
		// rapikan spasi berulang
		.replace(/[ \t]{2,}/g, ' ')
		// hapus garis pemisah
		.replace(/^_{3,}$/gm, '')
		.replace(/^-{3,}$/gm, '')
		.trim();

	// Jika masih terlihat seperti daftar kaku dengan beberapa baris pendek, gabungkan.
	const lines = cleaned.split(/\n+/);
	if (lines.length > 2) {
		const shortLines = lines.filter(l => l.length < 50).length;
		if (shortLines >= lines.length * 0.6) {
			cleaned = lines.join(' ').replace(/\s{2,}/g, ' ');
		}
	}
	if (ENABLE_EMOJI) {
		// Batasi jumlah emoji total agar tidak spam
		const emojiRegex = /[\p{Extended_Pictographic}]/gu;
		const found = cleaned.match(emojiRegex) || [];
		const MAX_EMOJI = 6; // hard cap
		if (found.length > MAX_EMOJI) {
			let count = 0;
			cleaned = cleaned.replace(emojiRegex, m => (++count <= MAX_EMOJI ? m : ''));
		}
		// Hilangkan emoji berurutan (lebih dari 1) jadi satu
		cleaned = cleaned.replace(/([\p{Extended_Pictographic}]){2,}/gu, m => m[0]);
	} else {
		// Hapus semua emoji jika dinonaktifkan
		cleaned = cleaned.replace(/[\p{Extended_Pictographic}]/gu, '');
	}
	// Fallback: jika setelah normalisasi kosong, pakai raw original (trim)
	if (!cleaned) cleaned = text.trim();
	return cleaned;
}

// Utility untuk memangkas history agar tidak terlalu panjang (berbasis jumlah pesan saja sederhana)
function trimHistory(messages, maxMessages = 20) {
	if (messages.length <= maxMessages) return messages;
	return messages.slice(messages.length - maxMessages);
}

async function chatCompletion(prompt, options = {}) {
	const {
		temperature = 0.7,
		max_tokens = 256,
		top_p = 0.95
	} = options;

	try {
		if (!MODEL) {
			throw new Error('HF_MODEL belum diset di .env');
		}
		if (!BASE_URL) {
			throw new Error('HF_BASE_URL belum diset di .env');
		}

		const messages = [ { role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: prompt } ];

		const resp = await client.chat.completions.create({
			model: MODEL,
			messages,
			temperature,
			max_tokens,
			top_p
		});
		const choice = resp.choices?.[0];
		const raw = choice?.message?.content?.trim() || '';
		let text = normalizeOutput(raw);
		if (!raw) {
			text = 'Maaf, model tidak mengembalikan jawaban. Coba ulangi pertanyaan dengan sedikit detail tambahan.';
		} else if (!text) {
			text = raw; // fallback ke raw jika normalisasi menghasilkan kosong
		}
		return { reply: text, rawReply: raw, modelUsed: MODEL, usage: resp.usage || null, systemPromptApplied: true };
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

// Multi-turn: menerima array messages (tanpa system) dengan role 'user' / 'assistant'.
async function chatWithHistory(userMessages, options = {}) {
	const {
		temperature = 0.7,
		max_tokens = 512,
		top_p = 0.95
	} = options;

	try {
		if (!MODEL) throw new Error('HF_MODEL belum diset di .env');
		if (!BASE_URL) throw new Error('HF_BASE_URL belum diset di .env');
		const trimmed = trimHistory(userMessages, 20);
		const messages = [ { role: 'system', content: SYSTEM_PROMPT }, ...trimmed ];
		const resp = await client.chat.completions.create({
			model: MODEL,
			messages,
			temperature,
			max_tokens,
			top_p
		});
		const choice = resp.choices?.[0];
		const raw = choice?.message?.content?.trim() || '';
		let text = normalizeOutput(raw);
		if (!raw) {
			text = 'Maaf, belum ada jawaban dari model. Silakan coba tanyakan ulang atau ubah sedikit penjelasannya.';
		} else if (!text) {
			text = raw;
		}
		return { reply: text, rawReply: raw, modelUsed: MODEL, usage: resp.usage || null, systemPromptApplied: true, messagesUsed: messages.length };
	} catch (err) {
		if (err.response) {
			const status = err.response.status;
			if (status === 403) err.message = '403 Forbidden';
			else if (status === 404) err.message = '404 Not Found';
		}
		throw err;
	}
}

module.exports = { chatCompletion, chatWithHistory, getClientInfo };
