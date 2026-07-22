// functions/utils/translation-docx.js — ESM port of Katy's translation-docx.js
// Builds .docx files from the structured "blocks-v1" JSON that Claude produces.
// Used by translation-start (entity flattening), translation-poll (preview text),
// and translation-download (docx generation).

import {
  Document, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, VerticalAlign,
} from 'docx';

const BORDER     = { style: BorderStyle.SINGLE, size: 4, color: '8A8A8A' };
const CELL_BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
const NO_BORDER  = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const NO_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER };

// Half-point font sizes (docx convention: 21 = 10.5pt)
const SZ_BODY = 21, SZ_LABEL = 18, SZ_TITLE = 28, SZ_SUBTITLE = 19, SZ_SECTION = 19;

// ---------- parsing ----------

export function parseBlocks(text) {
  if (!text || typeof text !== 'string') return null;
  let t = text.trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) t = fence[1].trim();
  if (!t.startsWith('{')) {
    const start = t.indexOf('{');
    if (start === -1) return null;
    t = t.slice(start);
  }
  try {
    const obj = JSON.parse(t);
    if (obj && obj.format === 'blocks-v1' && Array.isArray(obj.blocks)) return obj;
  } catch { /* not JSON — legacy text */ }
  return null;
}

export function blocksToText(blocks) {
  const lines = [];
  for (const b of blocks || []) {
    if (!b || typeof b !== 'object') continue;
    switch (b.type) {
      case 'title': case 'subtitle': case 'section': case 'paragraph': case 'note':
        if (b.text) lines.push(String(b.text));
        break;
      case 'fields':
        for (const row of b.rows || []) {
          const parts = (row || []).filter(Boolean)
            .map(p => `${p.label ?? ''}: ${p.value ?? ''}`.trim());
          if (parts.length) lines.push(parts.join('   '));
        }
        break;
      case 'signatures':
        for (const s of b.items || []) {
          if (s) lines.push([s.caption, s.name].filter(Boolean).join(': '));
        }
        break;
    }
  }
  return lines.join('\n');
}

// ---------- block rendering ----------

function cellPara(text, { bold = false, size = SZ_BODY, align } = {}) {
  return new Paragraph({
    alignment: align,
    spacing: { before: 0, after: 0 },
    children: [new TextRun({ text: text ?? '', bold, size })],
  });
}

function labelCell(text, widthPct) {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    borders: CELL_BORDERS,
    shading: { fill: 'F2F2F2' },
    verticalAlign: VerticalAlign.CENTER,
    children: [cellPara(text, { bold: true, size: SZ_LABEL })],
  });
}

function valueCell(text, widthPct, columnSpan) {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    borders: CELL_BORDERS,
    columnSpan,
    verticalAlign: VerticalAlign.CENTER,
    children: [cellPara(text, { size: SZ_BODY })],
  });
}

function sectionRow(text) {
  return new TableRow({
    children: [new TableCell({
      columnSpan: 4,
      borders: CELL_BORDERS,
      shading: { fill: 'DDDDDD' },
      children: [cellPara(text, { bold: true, size: SZ_SECTION })],
    })],
  });
}

function fieldRows(rows) {
  const out = [];
  for (const row of rows || []) {
    const pairs = (row || []).filter(p => p && (p.label || p.value));
    for (let i = 0; i < pairs.length; i += 2) {
      const chunk = pairs.slice(i, i + 2);
      const cells = chunk.length === 2
        ? [
            labelCell(chunk[0].label, 17), valueCell(chunk[0].value, 33),
            labelCell(chunk[1].label, 17), valueCell(chunk[1].value, 33),
          ]
        : [labelCell(chunk[0].label, 17), valueCell(chunk[0].value, 83, 3)];
      out.push(new TableRow({ children: cells }));
    }
  }
  return out;
}

function makeGridTable(rows) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    margins: { top: 30, bottom: 30, left: 80, right: 80 },
    rows,
  });
}

function signatureTable(items) {
  const cols = (items || []).filter(Boolean).slice(0, 3);
  if (!cols.length) return null;
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: NO_BORDERS,
    margins: { top: 30, bottom: 30, left: 80, right: 80 },
    rows: [new TableRow({
      children: cols.map(s => new TableCell({
        width: { size: Math.floor(100 / cols.length), type: WidthType.PERCENTAGE },
        borders: NO_BORDERS,
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 240, after: 0 },
            children: [new TextRun({ text: '____________________________', size: SZ_BODY })],
          }),
          cellPara(s.caption, { bold: true, size: SZ_LABEL, align: AlignmentType.CENTER }),
          cellPara(s.name, { size: SZ_LABEL, align: AlignmentType.CENTER }),
        ],
      })),
    })],
  });
}

function renderBlocks(blocks) {
  const children = [];
  let gridRows = [];

  const flushGrid = () => {
    if (gridRows.length) {
      children.push(makeGridTable(gridRows));
      children.push(new Paragraph({
        spacing: { before: 0, after: 0 },
        children: [new TextRun({ text: '', size: 8 })],
      }));
      gridRows = [];
    }
  };

  for (const b of blocks || []) {
    if (!b || typeof b !== 'object') continue;
    switch (b.type) {
      case 'section':
        gridRows.push(sectionRow(b.text || ''));
        break;
      case 'fields':
        gridRows.push(...fieldRows(b.rows));
        break;
      case 'title':
        flushGrid();
        children.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 60, after: 80 },
          children: [new TextRun({ text: b.text || '', bold: true, size: SZ_TITLE })],
        }));
        break;
      case 'subtitle':
        flushGrid();
        children.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 20 },
          children: [new TextRun({ text: b.text || '', bold: true, size: SZ_SUBTITLE })],
        }));
        break;
      case 'paragraph':
        flushGrid();
        children.push(new Paragraph({
          spacing: { before: 40, after: 60 },
          children: [new TextRun({ text: b.text || '', size: SZ_BODY })],
        }));
        break;
      case 'note':
        flushGrid();
        children.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 30, after: 30 },
          children: [new TextRun({ text: b.text || '', italics: true, size: SZ_LABEL, color: '555555' })],
        }));
        break;
      case 'signatures': {
        flushGrid();
        const t = signatureTable(b.items);
        if (t) children.push(t);
        break;
      }
    }
  }
  flushGrid();
  return children;
}

// ---------- certification block ----------

export function certificationText(translatorName, sourceLanguage) {
  const name = translatorName || '_________________________';
  const lang = sourceLanguage || 'Spanish';
  return `I, ${name}, certify that I am competent to translate from ${lang} to English, and that the above translation is a true and accurate translation of the original document.`;
}

function certificationBlock(translatorName, sourceLanguage) {
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const name = translatorName || '_________________________';
  const line = (text, opts = {}) => new Paragraph({
    keepNext: true,
    spacing: { before: 0, after: 30 },
    children: [new TextRun({ text, size: SZ_BODY, ...opts })],
  });
  return [
    new Paragraph({
      keepNext: true,
      spacing: { before: 140, after: 80 },
      border: { top: { style: BorderStyle.SINGLE, size: 6, color: 'AAAAAA' } },
      children: [],
    }),
    new Paragraph({
      keepNext: true,
      spacing: { before: 0, after: 60 },
      children: [new TextRun({ text: 'CERTIFICATION OF TRANSLATION', bold: true, size: 24 })],
    }),
    new Paragraph({
      keepNext: true,
      spacing: { before: 0, after: 80 },
      children: [new TextRun({
        text: certificationText(translatorName, sourceLanguage),
        size: SZ_BODY,
      })],
    }),
    line(`Translator: ${name}`),
    line(`Date: ${today}`),
    new Paragraph({
      spacing: { before: 0, after: 0 },
      children: [new TextRun({ text: 'Signature: _______________________', size: SZ_BODY })],
    }),
  ];
}

// ---------- legacy flat-text rendering ----------

function renderLegacy(text, translatorName) {
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const finalText = (text || '')
    .replace(/\{\{translator_name\}\}/g, translatorName || '_________________________')
    .replace(/\[DATE\]/g, today);

  const children = [];
  for (const line of finalText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === '---') {
      children.push(new Paragraph({
        spacing: { before: 100, after: 100 },
        border: { top: { style: BorderStyle.SINGLE, size: 6, color: 'AAAAAA' } },
        children: [],
      }));
      continue;
    }
    if (trimmed === 'CERTIFICATION OF TRANSLATION') {
      children.push(new Paragraph({
        spacing: { before: 200, after: 100 },
        children: [new TextRun({ text: trimmed, bold: true, size: 24 })],
      }));
      continue;
    }
    children.push(new Paragraph({
      spacing: { before: 0, after: 40 },
      children: [new TextRun({ text: line, size: SZ_BODY })],
    }));
  }
  return children;
}

// ---------- entry points ----------

export function buildTranslationDocx(storedText, translatorName, includeCertification = true) {
  const parsed   = parseBlocks(storedText);
  const children = parsed
    ? [
        ...renderBlocks(parsed.blocks),
        ...(includeCertification ? certificationBlock(translatorName, parsed.source_language) : []),
      ]
    : renderLegacy(storedText, translatorName);

  return new Document({
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: SZ_BODY } },
      },
    },
    sections: [{
      properties: {
        page: { margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } },
      },
      children,
    }],
  });
}

export function translationText(storedText) {
  const parsed = parseBlocks(storedText);
  return parsed ? blocksToText(parsed.blocks) : (storedText || '');
}
