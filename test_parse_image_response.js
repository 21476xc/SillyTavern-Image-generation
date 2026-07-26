/**
 * Local self-test for ST-Custom-ImageGen image response parsing.
 * Extracts pure helper functions from index.js and runs fixture cases in Node.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const indexPath = path.join(__dirname, 'index.js');
const src = fs.readFileSync(indexPath, 'utf8');

// Extract the pure-parsing helper block: from arrayBufferToBase64 up to (not
// including) callImageApi. It contains everything parseImageResponse needs.
const parseStart = src.indexOf('function arrayBufferToBase64');
const parseEnd = src.indexOf('async function callImageApi');
if (parseStart < 0 || parseEnd < 0 || parseEnd <= parseStart) {
  console.error('Could not locate helper block in index.js');
  process.exit(1);
}
const helperSrc = src.slice(parseStart, parseEnd);

const sandbox = {
  console,
  Buffer,
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  settings: {},
  WeakSet,
};
vm.createContext(sandbox);
vm.runInContext(helperSrc + '\n;this.__exports = { parseImageResponse, coerceImageRef, summarizeResponseShape, makeImageRefFromBase64, makeImageRefFromUrl };', sandbox);
const { parseImageResponse, summarizeResponseShape } = sandbox.__exports;

const tinyPngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const cases = [
  {
    name: 'openai data[].url',
    data: { data: [{ url: 'https://cdn.example.com/a.png' }] },
    expectUrl: 'https://cdn.example.com/a.png',
  },
  {
    name: 'openai data[].b64_json',
    data: { data: [{ b64_json: tinyPngB64 }] },
    expectDataUriPrefix: 'data:image/png;base64,',
  },
  {
    name: 'nested image_url object',
    data: { data: [{ image_url: { url: 'https://cdn.example.com/nested.jpg' } }] },
    expectUrl: 'https://cdn.example.com/nested.jpg',
  },
  {
    name: 'choices message content array parts',
    data: {
      choices: [{
        message: {
          content: [
            { type: 'text', text: 'done' },
            { type: 'image_url', image_url: { url: 'https://cdn.example.com/part.png' } },
          ],
        },
      }],
    },
    expectUrl: 'https://cdn.example.com/part.png',
  },
  {
    name: 'gemini inlineData',
    data: {
      candidates: [{
        content: {
          parts: [
            { text: 'ok' },
            { inlineData: { mimeType: 'image/png', data: tinyPngB64 } },
          ],
        },
      }],
    },
    expectDataUriPrefix: 'data:image/png;base64,',
  },
  {
    name: 'gemini inline_data snake',
    data: {
      candidates: [{
        content: {
          parts: [{ inline_data: { mime_type: 'image/jpeg', data: tinyPngB64 } }],
        },
      }],
    },
    expectDataUriPrefix: 'data:image/jpeg;base64,',
  },
  {
    name: 'aliases file_url / image_base64 / images[]',
    data: { images: [{ file_url: 'https://cdn.example.com/file.webp' }] },
    expectUrl: 'https://cdn.example.com/file.webp',
  },
  {
    name: 'raw image package',
    data: {
      __stcigRawImage: true,
      contentType: 'image/png',
      b64_json: tinyPngB64,
      dataUri: 'data:image/png;base64,' + tinyPngB64,
      url: 'data:image/png;base64,' + tinyPngB64,
    },
    expectDataUriPrefix: 'data:image/png;base64,',
  },
  {
    name: 'markdown in content string',
    data: { choices: [{ message: { content: 'here ![x](https://cdn.example.com/md.png)' } }] },
    expectUrl: 'https://cdn.example.com/md.png',
  },
  {
    name: 'deep exotic envelope',
    data: { response: { result: { artifacts: [{ media: { image_base64: tinyPngB64, mime: 'image/png' } }] } } },
    expectDataUriPrefix: 'data:image/png;base64,',
  },
  // --- edge cases ---
  {
    name: 'bare url string response',
    data: 'https://cdn.example.com/plain.png',
    expectUrl: 'https://cdn.example.com/plain.png',
  },
  {
    name: 'bare data-uri string response',
    data: 'data:image/png;base64,' + tinyPngB64,
    expectDataUriPrefix: 'data:image/png;base64,',
  },
  {
    name: 'bare base64 string response',
    data: tinyPngB64,
    expectDataUriPrefix: 'data:image/png;base64,',
  },
  {
    name: 'multi-image data[] picks first',
    data: {
      data: [
        { url: 'https://cdn.example.com/first.png' },
        { url: 'https://cdn.example.com/second.png' },
      ],
    },
    expectUrl: 'https://cdn.example.com/first.png',
  },
  {
    name: 'mixed b64 + url in data[] picks first (b64)',
    data: {
      data: [
        { b64_json: tinyPngB64 },
        { url: 'https://cdn.example.com/second.png' },
      ],
    },
    expectDataUriPrefix: 'data:image/png;base64,',
  },
  {
    name: 'protocol-relative url normalized to https',
    data: { data: [{ url: '//cdn.example.com/rel.png' }] },
    expectUrl: 'https://cdn.example.com/rel.png',
  },
  {
    name: 'base64 with data-uri prefix inside b64_json',
    data: { data: [{ b64_json: 'data:image/webp;base64,' + tinyPngB64 }] },
    expectDataUriPrefix: 'data:image/webp;base64,',
  },
  {
    name: 'url-safe base64 converted to standard',
    data: { data: [{ b64_json: tinyPngB64.replace(/\+/g, '-').replace(/\//g, '_') }] },
    expectDataUriPrefix: 'data:image/png;base64,',
  },
  {
    name: 'top-level url alias',
    data: { url: 'https://cdn.example.com/top.png' },
    expectUrl: 'https://cdn.example.com/top.png',
  },
  {
    name: 'top-level b64_json alias',
    data: { b64_json: tinyPngB64 },
    expectDataUriPrefix: 'data:image/png;base64,',
  },
  {
    name: 'base64 in "url" field of data[]',
    data: { data: [{ url: tinyPngB64 }] },
    expectDataUriPrefix: 'data:image/png;base64,',
  },
];

// error cases: parseImageResponse must throw
const errorCases = [
  { name: 'null response', data: null },
  { name: 'empty string response', data: '' },
  { name: 'empty object response', data: {} },
  { name: 'empty data[] response', data: { data: [] } },
  { name: 'text-only chat response', data: { choices: [{ message: { content: 'plain words only' } }] } },
];

let failed = 0;
for (const c of cases) {
  try {
    const hit = parseImageResponse(c.data);
    if (c.expectUrl && hit.url !== c.expectUrl) {
      throw new Error('url mismatch: ' + hit.url);
    }
    if (c.expectDataUriPrefix && !(hit.dataUri || hit.url || '').startsWith(c.expectDataUriPrefix)) {
      throw new Error('dataUri mismatch: ' + (hit.dataUri || hit.url || '').slice(0, 80));
    }
    console.log('PASS', c.name);
  } catch (err) {
    failed += 1;
    console.error('FAIL', c.name, err.message);
  }
}

for (const c of errorCases) {
  try {
    const hit = parseImageResponse(c.data);
    failed += 1;
    console.error('FAIL', c.name, 'should throw, got', JSON.stringify(hit).slice(0, 80));
  } catch (err) {
    console.log('PASS', c.name, '(threw)');
  }
}

// negative case should include shape summary
try {
  parseImageResponse({ foo: { bar: 1 }, choices: [{ message: { content: 'no image here' } }] });
  failed += 1;
  console.error('FAIL negative case should throw');
} catch (err) {
  if (!String(err.message).includes('响应结构')) {
    failed += 1;
    console.error('FAIL negative shape missing', err.message);
  } else {
    console.log('PASS negative shape summary');
    console.log('  ', err.message.slice(0, 180));
  }
}

console.log(failed ? `FAILED ${failed}` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
