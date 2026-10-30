const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const arPath = path.join(root, 'src/i18n/locales/ar.json');
const enPath = path.join(root, 'src/i18n/locales/en.json');
const esPath = path.join(root, 'src/i18n/locales/es.json');
const idPath = path.join(root, 'src/i18n/locales/id.json');
const ptBrPath = path.join(root, 'src/i18n/locales/pt-BR.json');
const trPath = path.join(root, 'src/i18n/locales/tr.json');
const outPath = path.join(root, 'src/i18n/runtime-resources.ts');

function toAsciiJson(value) {
  return JSON.stringify(value, null, 2).replace(/[^\x00-\x7F]/g, (char) =>
    `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

const ar = JSON.parse(fs.readFileSync(arPath, 'utf8'));
const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));
const es = JSON.parse(fs.readFileSync(esPath, 'utf8'));
const id = JSON.parse(fs.readFileSync(idPath, 'utf8'));
const ptBr = JSON.parse(fs.readFileSync(ptBrPath, 'utf8'));
const tr = JSON.parse(fs.readFileSync(trPath, 'utf8'));

const output = [
  `export const AR_RESOURCES = ${toAsciiJson(ar)} as const;`,
  '',
  `export const EN_RESOURCES = ${toAsciiJson(en)} as const;`,
  '',
  `export const ES_RESOURCES = ${toAsciiJson(es)} as const;`,
  '',
  `export const ID_RESOURCES = ${toAsciiJson(id)} as const;`,
  '',
  `export const PT_BR_RESOURCES = ${toAsciiJson(ptBr)} as const;`,
  '',
  `export const TR_RESOURCES = ${toAsciiJson(tr)} as const;`,
  '',
].join('\n');

fs.writeFileSync(outPath, output);
