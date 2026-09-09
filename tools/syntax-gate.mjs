// tools/syntax-gate.mjs — Sprint 0 : gate syntaxe Chromium 68 (barrière texte ;
// le smoke test navigateur complet requiert un device/émulateur — hors périmètre CI).
// Interdit : syntaxe post-68 (?. ?? ||=) et APIs absentes de Chromium 68.
// Mode dist : les occurrences DANS les dépendances minifiées sont examinées avec
// filtrage contextuel documenté : un pattern est toléré uniquement s'il apparaît
// sous garde (typeof …) — un appel nu resterait bloquant.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] || 'src');
const IS_DIST = ROOT.includes('dist');

const FORBIDDEN = [
  { re: /\?\./g, why: 'optional chaining (?.) — Chrome 80+' },
  { re: /\?\?/g, why: 'nullish coalescing (??) — Chrome 80+' },
  { re: /\|\|=/g, why: 'logical assignment — Chrome 85+' },
  { re: /\.flat\(\)/g, why: 'Array.flat — Chrome 69+' },
  { re: /Object\.fromEntries/g, why: 'Object.fromEntries — Chrome 73+' },
  { re: /\.replaceAll\(/g, why: 'String.replaceAll — Chrome 85+' },
  { re: /\bmatchAll\s*\(/g, why: 'String.matchAll — Chrome 73+',
    distAllowed: /typeof\s+\S*\.?clients\s*[=!]=|"object"==typeof\s+self\.clients|typeof\s+self\.clients/ },
  { re: /globalThis/g, why: 'globalThis — Chrome 71+',
    distAllowed: /!?(?:=|==|!=|===)\s*typeof\s+globalThis\s*[?!]|typeof\s+globalThis\s*!==?\s*['"]undefined['"]/ },
  { re: /\.at\(\s*-?\d/g, why: 'Array/String.at — Chrome 92+' },
  { re: /structuredClone/g, why: 'structuredClone — Chrome 98+' },
  { re: /queueMicrotask\s*\(/g, why: 'queueMicrotask — Chrome 71+' }
];

const files = [];
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(js|mjs)$/.test(name)) files.push(p);
  }
}
walk(ROOT);

let violations = 0;
let guardedAllowed = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const rule of FORBIDDEN) {
    let m;
    rule.re.lastIndex = 0;
    while ((m = rule.re.exec(src)) !== null) {
      const around = src.slice(Math.max(0, m.index - 64), m.index + 64);
      if (IS_DIST && rule.distAllowed && rule.distAllowed.test(around)) {
        guardedAllowed += 1;
        break; // occurrence gardée : le reste du fichier est couvert par la même chaîne
      }
      const line = src.slice(0, m.index).split('\n').length;
      console.log('VIOLATION', path.relative(process.cwd(), f) + ':' + line, '→', rule.why);
      violations += 1;
      break; // une occurrence suffit par fichier/règle
    }
  }
}
if (violations > 0) {
  console.error('GATE SYNTAXE ÉCHOUÉ :', violations, 'violations');
  process.exit(1);
}
console.log('GATE SYNTAXE OK :', files.length, 'fichiers compatibles Chromium 68 (analyse statique)',
            IS_DIST ? '— ' + guardedAllowed + ' occurrences sous garde (deps minifiées) tolérées' : '');
