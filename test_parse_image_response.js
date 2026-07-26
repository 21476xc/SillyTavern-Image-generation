/**
 * Local self-test for ST-Custom-ImageGen image response parsing.
 * Extracts pure helper functions from index.js and runs fixture cases in Node.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const indexPath = path.join(__dirname, 'index.js');
const src = fs.readFileSync(indexPath, 'utf8');

const start = src.indexOf('function arrayBufferToBase64');
const end = src.indexOf('async function callExtractorApi');
if (start < 0 || end < 0) {
  console.error('Could not locate helper block');
  process.exit(1);
}

// Include helpers from arrayBufferToBase64 through findImageRefDeep/parseImageResponse,
// but stop before callExtractorApi. We also need fetchJson? No, pure parse only.
// Actually parseImageResponse is after callExtractorApi/buildImageRequestBody/coerce...
// Better extract from arrayBufferToBase64 to end of parseImageResponse.

const parseStart = src.indexOf('function arrayBufferToBase64');
const parseEnd = src.indexOf('async function callImageApi');
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
