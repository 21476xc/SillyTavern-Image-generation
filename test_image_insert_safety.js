/**
 * Regression: base64/dataURI must not be treated as prompt-safe markdown targets.
 * Mirrors the pure helpers in index.js (keep in sync).
 */
function lookLikeBase64Image(s) {
    const raw = String(s || '').replace(/\s+/g, '');
    if (raw.length < 64) return false;
    if (!(raw.length % 4 === 0 || raw.endsWith('='))) {
        // still allow long base64-ish without strict padding
        if (raw.length < 128) return false;
    }
    return /^[A-Za-z0-9+/=_-]+$/.test(raw);
}

function isBulkyImageRef(value) {
    const s = String(value || '').trim();
    if (!s) return false;
    if (s.startsWith('data:image/')) return true;
    if (s.startsWith('data:application/octet-stream;base64,')) return true;
    if (!/^https?:\/\//i.test(s) && !s.startsWith('/') && !s.startsWith('blob:') && lookLikeBase64Image(s)) {
        return true;
    }
    if (!/^https?:\/\//i.test(s) && !s.startsWith('/') && s.length > 2048) return true;
    return false;
}

function isPromptSafeImageRef(value) {
    const s = String(value || '').trim();
    if (!s) return false;
    if (isBulkyImageRef(s)) return false;
    if (/^https?:\/\//i.test(s)) return true;
    if (s.startsWith('//')) return true;
    if (s.startsWith('/') || s.startsWith('user/') || s.startsWith('characters/') || s.startsWith('./')) return true;
    return s.length <= 512 && !s.includes('base64,');
}

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
    console.log('PASS', msg);
}

const hugeB64 = 'A'.repeat(3000);
const dataUri = `data:image/png;base64,${hugeB64}`;
const http = 'https://cdn.example.com/a.png';
const local = '/user/images/stcig-1.png';

assert(isBulkyImageRef(dataUri), 'data URI is bulky');
assert(isBulkyImageRef(hugeB64), 'bare long base64 is bulky');
assert(!isPromptSafeImageRef(dataUri), 'data URI not prompt-safe');
assert(!isPromptSafeImageRef(hugeB64), 'bare base64 not prompt-safe');
assert(isPromptSafeImageRef(http), 'http url is prompt-safe');
assert(isPromptSafeImageRef(local), 'local path is prompt-safe');
assert(!isBulkyImageRef(http), 'http not bulky');

// Source guard checks
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, 'index.js'), 'utf8');
assert(src.includes('resolveImageInsertPlan'), 'source has resolveImageInsertPlan');
assert(src.includes('isBulkyImageRef'), 'source has isBulkyImageRef');
assert(src.includes('trySaveImageToSillyTavern'), 'source has trySaveImageToSillyTavern');
assert(src.includes('已跳过 Markdown 内联 base64') || src.includes('避免污染 Chat History'), 'source logs safety fallback');
assert(!/mes\.mes = `\$\{String\(mes\.mes \|\| ''\)\.trim\(\)\}\\n\\n\$\{buildMarkdownImage\(imageUrl/.test(src), 'old unsafe direct imageUrl markdown insert removed');

console.log('ALL PASSED');
