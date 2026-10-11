#!/usr/bin/env node
/** Export the editable HTML poster with local, installed rendering libraries. */
const { createRequire } = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const output = path.resolve(process.argv[2] || path.join(__dirname, 'exports/20261011-preview-v2'));
const localRequire = process.env.PROMO_NODE_MODULES
  ? createRequire(path.join(process.env.PROMO_NODE_MODULES, '__poster_render__.cjs'))
  : require;
const { chromium } = localRequire('playwright');
const sharp = localRequire('sharp');
const png = path.join(output, 'pindu-social-poster.png');
const jpg = path.join(output, 'pindu-social-poster.jpg');
const report = path.join(output, 'layout.json');

(async () => {
  for (const file of [png, jpg, report]) {
    if (fs.existsSync(file)) throw new Error(`Export already exists: ${file}`);
  }
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: process.env.PROMO_BROWSER_CHANNEL || 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1440 }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(path.join(__dirname, 'poster.html')).href);
    await page.evaluate(() => document.fonts.ready);
    const layout = await page.evaluate(() => {
      const images = Array.from(document.images).map(img => ({
        source: img.getAttribute('src'), loaded: img.complete && img.naturalWidth > 0,
        naturalSize: [img.naturalWidth, img.naturalHeight],
        displayedSize: [img.width, img.height],
      }));
      const texts = Array.from(document.querySelectorAll('h1, h2, p, .brand-name, .brand-en, .category, .url'))
        .map(el => {
          const r = el.getBoundingClientRect();
          return { text: el.innerText, rectangle: [r.x, r.y, r.width, r.height], overflow: el.scrollWidth > el.clientWidth };
        });
      return { images, texts, width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight };
    });
    if (layout.images.some(img => !img.loaded)) throw new Error('A poster image did not load');
    if (layout.width !== 1080 || layout.height !== 1440) throw new Error('Poster canvas overflow');
    if (layout.texts.some(t => t.overflow || t.rectangle[0] < 0 || t.rectangle[1] < 0 || t.rectangle[0] + t.rectangle[2] > 1080 || t.rectangle[1] + t.rectangle[3] > 1440)) {
      throw new Error('Poster text overflow');
    }
    const screenshot = await page.locator('.poster').screenshot({ path: png });
    await sharp(screenshot).jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toFile(jpg);
    fs.writeFileSync(report, JSON.stringify(layout, null, 2) + '\n');
    console.log(JSON.stringify({ png, jpg, imageCount: layout.images.length, textCount: layout.texts.length }));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error.message); process.exit(1); });
