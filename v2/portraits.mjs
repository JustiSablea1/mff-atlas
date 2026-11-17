const BASE_SIZE = 1536;
const COLUMNS = 8;

export function decodeFeatures(data) {
  return data.trim().split('\n').map(line => {
    const [id, uniform, bytes] = JSON.parse(line);
    return { id, uniform, feature: Float32Array.from(atob(bytes), c => (c.charCodeAt(0) - 128) / 32) };
  });
}

export function signature(pixels) {
  const input = new Float32Array(64);
  let sum = 0, squares = 0, index = 0;
  for (let y = 1; y < 9; y++) {
    for (let x = 2; x < 10; x++) {
      const p = (y * 12 + x) * 4;
      const value = (pixels[p] * .299 + pixels[p + 1] * .587 + pixels[p + 2] * .114);
      input[index++] = value;
      sum += value;
      squares += value * value;
    }
  }
  const mean = sum / input.length;
  const scale = Math.max(8, Math.sqrt(Math.max(0, squares / input.length - mean * mean)));
  return input.map(value => (value - mean) / scale);
}

function match(feature, samples) {
  let best, bestCost = Infinity, other = Infinity;
  for (const sample of samples) {
    let distance = 0;
    for (let i = 0; i < feature.length; i++) {
      distance += (feature[i] - sample.feature[i]) ** 2;
      if (distance >= other) break;
    }
    if (distance < bestCost) {
      if (best && best.id !== sample.id) other = bestCost;
      best = sample;
      bestCost = distance;
    } else if (sample.id !== best?.id && distance < other) {
      other = distance;
    }
  }
  return { sample: best, cost: bestCost / 64, separation: (other - bestCost) / 64 };
}

export function matchGrid({ width, height, tile }, samples) {
  const scale = width / BASE_SIZE;
  if (height / width < .41 || height / width > .56 || !samples.length) return [];
  const test = (x, y) => match(signature(tile(x * scale, y * scale, 122 * scale)), samples);
  let best = { score: 0 };
  // Locate the first complete row using four cells spaced across the visible grid.
  for (let y = 145; y <= 216; y += 4) {
    for (const x of [237, 241, 245]) {
      const hits = [0, 2, 4, 6].map(col => test(x + 133 * col, y));
      const score = hits.reduce((value, hit) => value + Math.max(0, 1 - hit.cost * 2), 0);
      if (score > best.score) best = { score, x, y, hits };
    }
  }
  if (best.score < 1.9 || best.hits.filter(hit => hit.cost <= .18 && hit.separation >= .055).length < 2) return [];
  const matched = [];
  for (let row = 0; row < 3; row++) {
    const y = best.y + row * 195;
    if ((y + 94) * scale > height) break;
    for (let col = 0; col < COLUMNS; col++) {
      const x = best.x + col * 133;
      const hit = test(x, y);
      if (hit.cost <= .19 && hit.separation >= .075) matched.push({
        id: hit.sample.id, uniform: hit.sample.uniform, hint: 'Портрет · ряд ' + (row + 1) + ', столбец ' + (col + 1)
      });
    }
  }
  return matched;
}

let features;
export async function recognizePortraits(image) {
  if (image.naturalHeight / image.naturalWidth < .41 || image.naturalHeight / image.naturalWidth > .56) return [];
  if (!features) {
    features = fetch(new URL('./portraits.ndjson', import.meta.url)).then(response => {
      if (!response.ok) throw new Error('Справочник портретов недоступен.');
      return response.text();
    }).then(decodeFeatures).catch(error => { features = null; throw error; });
  }
  const samples = await features;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 12;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return matchGrid({
    width: image.naturalWidth, height: image.naturalHeight,
    tile: (x, y, size) => {
      ctx.clearRect(0, 0, 12, 12);
      ctx.drawImage(image, x, y, size, size, 0, 0, 12, 12);
      return ctx.getImageData(0, 0, 12, 12).data;
    }
  }, samples);
}
