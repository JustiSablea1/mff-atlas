import { normalize } from './profile.mjs';
import { recognizePortraits } from './portraits.mjs';

export function matchLines(text, catalog) {
  const candidates = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = /(?:\b(?:lv\.?|level|ур\.?|уровень)\s*[:.]?\s*(\d{1,2}))|(?:\s[—–|]\s*(\d{1,2})\s*$)/iu.exec(line);
    const seenLevel = Number(match?.[1] || match?.[2]);
    const level = seenLevel >= 1 && seenLevel <= 80 ? seenLevel : null;
    const seenTier = /\btier\s*[-:]?\s*(iv|iii|ii|i|[1-4])\b/i.exec(line)?.[1]?.toUpperCase();
    const tier = ['','I','II','III','IV'][Number(seenTier)] || seenTier || '';
    const name = line.replace(match?.[0] ?? /$^/, '').replace(/\btier\s*[-:]?\s*(iv|iii|ii|i|[1-4])\b/i, '');
    const hero = catalog.byName.get(normalize(name));
    if (!hero) continue;
    const prior = candidates.get(hero.id);
    if (prior) {
      if (level && prior.level !== level) prior.level = null;
      if (tier && prior.tier !== tier) prior.tier = '';
      continue;
    }
    candidates.set(hero.id, { name: hero.name, level, tier, owned: true, reviewed: false });
  }
  return [...candidates.values()];
}

let library;
function loadOcr() {
  if (!library) library = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js';
    script.crossOrigin = 'anonymous';
    script.integrity = 'sha384-r1ru3tcf6FhnCFR4B7pIFG+BhFF9LlFtz/P1y4pblWn3AGs9y3lBx5SKLNf4+rED';
    script.onload = () => resolve(window.Tesseract);
    script.onerror = () => { library = null; script.remove(); reject(new Error('Не удалось загрузить модуль OCR.')); };
    document.head.append(script);
  });
  return library;
}

async function withImage(file, fn) {
  const src = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = src;
    await image.decode();
    return await fn(image);
  } finally {
    URL.revokeObjectURL(src);
  }
}

async function prepareImage(file) {
  return withImage(file, async image => {
    const scale = Math.min(1, 2000 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  });
}

export async function recognize(files, language, onProgress, textOnly = false) {
  if (!files.length || files.length > 12) throw new Error('Выбери от 1 до 12 скриншотов за один раз.');
  if (files.some(file => file.size > 20 * 1024 * 1024)) throw new Error('Каждый скриншот должен занимать до 20 МБ.');
  const here = path => new URL(path, import.meta.url).href;
  let worker;
  const results = [];
  try {
    for (const file of files) {
      onProgress(results.length, 0);
      try {
        const matches = textOnly ? [] : await withImage(file, recognizePortraits);
        if (matches.length) {
          results.push({ name: file.name, text: '', matches });
          continue;
        }
        if (!worker) {
          const tesseract = await loadOcr();
          const languages = await Promise.all(language.split('+').map(async code => {
            const base = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/';
            const response = await fetch(base + code + '@1.0.0/4.0.0_best_int/' + code + '.traineddata.gz');
            if (!response.ok) throw new Error('Не удалось загрузить словарь OCR.');
            return { code, data: new Uint8Array(await response.arrayBuffer()) };
          }));
          worker = await tesseract.createWorker(languages, 1, {
            workerPath: here('./ocr-worker.js'),
            corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0',
            workerBlobURL: false,
            logger: progress => { if (progress.status === 'recognizing text') onProgress(results.length, progress.progress); },
            errorHandler: error => { console.warn('Atlas OCR:', error); }
          });
          await worker.setParameters({ tessedit_pageseg_mode: tesseract.PSM.SPARSE_TEXT });
        }
        const { data } = await worker.recognize(await prepareImage(file));
        results.push({ name: file.name, text: data.text.trim(), confidence: Math.round(data.confidence) });
      } catch (error) {
        results.push({ name: file.name, text: '', error: error.message || 'Изображение не прочитано. Попробуй PNG или JPEG.' });
      }
    }
    return results;
  } finally {
    if (worker) await worker.terminate();
  }
}
