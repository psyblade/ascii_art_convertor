// Build: minify + obfuscate the site into dist/
//
//   node build.mjs        (run from the build/ directory, or: npm run build)
//
// The app is a plain static site with its JavaScript inline in each HTML file,
// so the build (1) obfuscates that inline script and (2) minifies the HTML/CSS.
// Sample images are copied through so the deployed site stays self-contained.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { minify } from 'html-minifier-terser';
import JavaScriptObfuscator from 'javascript-obfuscator';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dist = path.join(root, 'dist');

const PAGES = ['index.html', 'dark.html', 'light.html'];

// The app's own script is the only <script> tag with no attributes; the
// html2canvas CDN tag has src=, so it never matches.
const INLINE_SCRIPT = /<script>([\s\S]*?)<\/script>/;

// Deliberately moderate: enough to be unreadable, without the settings that
// make bundles slow (controlFlowFlattening / deadCodeInjection) or that fight
// re-minification (selfDefending).
const OBFUSCATOR_OPTIONS = {
  compact: true,
  seed: 0,                          // fixes the RNG seed; output is still NOT byte-reproducible between runs
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: true,
  stringArray: true,
  stringArrayThreshold: 0.3,        // keep the hot conversion loop fast
  stringArrayEncoding: ['none'],    // base64 decoding per string in the pixel loop was measurably slower
  stringArrayRotate: false,         // rotate/shuffle ignore `seed`, which made builds non-reproducible
  stringArrayShuffle: false,
  splitStrings: false,
  numbersToExpressions: true,
  simplify: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  selfDefending: false,
  debugProtection: false,
  disableConsoleOutput: false,
};

const MINIFY_OPTIONS = {
  collapseWhitespace: true,
  removeComments: true,
  minifyCSS: true,
  minifyJS: false,                  // already obfuscated above
  removeAttributeQuotes: false,
  removeOptionalTags: false,
  sortAttributes: false,
  sortClassName: false,
};

async function copyDir(from, to) {
  await fs.mkdir(to, { recursive: true });
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) await copyDir(src, dst);
    else await fs.copyFile(src, dst);
  }
}

async function buildPage(file) {
  const source = await fs.readFile(path.join(root, file), 'utf8');
  const match = source.match(INLINE_SCRIPT);
  if (!match) throw new Error(`no inline <script> found in ${file}`);

  const obfuscated = JavaScriptObfuscator
    .obfuscate(match[1], OBFUSCATOR_OPTIONS)
    .getObfuscatedCode();

  // Replacer FUNCTION, not a string: obfuscated code contains "$&"-style
  // sequences that String.replace would otherwise treat as patterns.
  let html = source.replace(INLINE_SCRIPT, () => `<script>${obfuscated}</script>`);
  html = await minify(html, MINIFY_OPTIONS);

  await fs.writeFile(path.join(dist, file), html);
  return { file, before: source.length, after: html.length };
}

await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(dist, { recursive: true });

const results = [];
for (const page of PAGES) results.push(await buildPage(page));

await copyDir(path.join(root, 'imgs'), path.join(dist, 'imgs'));
// Stops GitHub Pages running Jekyll over the output.
await fs.writeFile(path.join(dist, '.nojekyll'), '');

console.log('built dist/');
for (const r of results) {
  const pct = (100 * (1 - r.after / r.before)).toFixed(1);
  console.log(`  ${r.file.padEnd(12)} ${String(r.before).padStart(7)} -> ${String(r.after).padStart(7)} bytes  (-${pct}%)`);
}
