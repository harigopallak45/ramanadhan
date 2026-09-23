// =====================================================================
// Renders the structured report (fullReport.js) as a Word document laid
// out exactly like the firm's issued External Review Reports — the same
// fonts (Aptos Display headings, Aptos body), heading colour, sizes,
// spacing, alignment, borderless profile table, bullets, signature mark
// and grey page footer as the signed sample. Pure formatting — nothing
// here decides or rewrites content.
//
// Measured from the sample (Amal Express, 2026):
//   page      A4, 1" margins
//   body      Aptos 12pt, single-spaced, justified, blank paragraph between
//             paragraphs (spacing after 0, line 240)
//   H1        Aptos Display 20pt #0F4761, centred (title block only)
//   H2        Aptos Display 16pt #0F4761 (sections 4–8, bold runs)
//   H3        Aptos 14pt #0F4761 (sections 1–3 bold; 3.x and areas A–Q plain)
//   H4        Aptos 12pt italic #0F4761 ("Requirement", "Auditor Observation";
//             "Business Overview" bold)
//   table     two columns 2738/6288 twips, no borders, bold first column
//   footer    "Page X of Y" in grey #7F7F7F
//   cover     grey #D8D8D8 band: year 48pt, reviewer (caps, bold), brand,
//             date; title "AML/CTF External Review Report" 34pt right-aligned
// =====================================================================
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell,
  Footer, PageNumber, HeadingLevel, AlignmentType, WidthType, BorderStyle,
  ShadingType, LevelFormat, VerticalAlign, TableLayoutType
} = require('docx');

const ASSETS = path.join(__dirname, 'assets');
const LOGO = path.join(ASSETS, 'centinl-logo.png');
const SIGNATURE = path.join(ASSETS, 'centinl-signature.png');

const BODY_FONT = 'Aptos';            // Word's "minor" theme font in the sample
const HEADING_FONT = 'Aptos Display'; // Word's "major" theme font in the sample
const HEADING_COLOR = '0F4761';
const FOOTER_COLOR = '7F7F7F';
const BAND_FILL = 'D8D8D8';

// A4, 1" margins — identical to the issued report.
const PAGE = { width: 11906, height: 16838, margin: 1440 };
const CONTENT_WIDTH = PAGE.width - 2 * PAGE.margin; // 9026 twips
const SINGLE = { after: 0, line: 240, lineRule: 'auto' };

const readAsset = p => (fs.existsSync(p) ? fs.readFileSync(p) : null);

// ---- Paragraph helpers -----------------------------------------------------
// Every body paragraph in the sample is single-spaced with no space after,
// and paragraphs are separated by an empty paragraph — reproduced here.
const blank = (opts = {}) => new Paragraph({ spacing: SINGLE, children: [], ...(opts.keepNext ? { keepNext: true } : {}) });
const runs = (list, opts = {}) => new Paragraph({
  alignment: opts.align || AlignmentType.JUSTIFIED,
  spacing: SINGLE,
  children: list.map(r => new TextRun(r)),
  ...(opts.keepNext ? { keepNext: true } : {}),
  ...(opts.keepLines ? { keepLines: true } : {})
});
const body = (text, opts = {}) => runs([{ text: String(text || ''), bold: !!opts.bold, italics: !!opts.italics, size: opts.size }], opts);
// A body paragraph followed by the sample's blank separator paragraph.
const para = (text, opts = {}) => [body(text, opts), blank(opts)];
const paras = (list, opts = {}) => (Array.isArray(list) ? list : [list]).filter(Boolean).flatMap(p => para(p, opts));

// Headings are Word heading styles (so the document outline works) with
// the sample's run-level bold applied where it applied it.
const heading = (text, level, opts = {}) => new Paragraph({
  heading: level,
  keepNext: true, keepLines: true,
  ...(opts.center ? { alignment: AlignmentType.CENTER } : {}),
  ...(opts.spacingAfter != null ? { spacing: { after: opts.spacingAfter } } : {}),
  children: [new TextRun({ text: String(text || ''), bold: !!opts.bold, size: opts.size })]
});
const bullet = (text, opts = {}) => new Paragraph({
  numbering: { reference: 'bullets', level: 0 },
  ...(opts.justify ? { alignment: AlignmentType.JUSTIFIED } : {}),
  spacing: SINGLE,
  children: [new TextRun({ text: String(text || '') })]
});

const assessmentLines = (r, opts = {}) => [
  runs([{ text: 'Overall Assessment: ', bold: true }, { text: r.score.assessment, bold: true }], opts),
  runs([{ text: 'Indicative Overall Compliance Rating: ', bold: true }, { text: `${r.score.value}/100`, bold: true }], opts)
];

function noBorders() {
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  return { top: none, bottom: none, left: none, right: none };
}

// ---- Cover page ------------------------------------------------------------
// Its own section with zero top/bottom/left margins so the grey band runs
// edge to edge down the page, as on the issued reports. The row is a
// little shorter than the page so the paragraph Word needs after a table
// (the one carrying the section break) still fits on the same page.
const COVER = { marginRight: 1440, bandWidth: 4900, rowHeight: PAGE.height - 700 };
const COVER_WIDTH = PAGE.width - COVER.marginRight;

function coverPage(r, logo) {
  const bandWidth = COVER.bandWidth;
  const bandCell = new TableCell({
    width: { size: bandWidth, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, fill: BAND_FILL, color: 'auto' },
    verticalAlign: VerticalAlign.TOP,
    margins: { top: 400, bottom: 400, left: 900, right: 240 },
    borders: noBorders(),
    children: [
      new Paragraph({ spacing: { before: 5400, after: 200 }, children: [new TextRun({ text: r.meta.year, size: 96 })] }),
      new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: String(r.meta.auditorName || '').toUpperCase(), size: 22, bold: true })] }),
      new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: r.meta.brandName || '', size: 22 })] }),
      new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: r.meta.concludedLabel || '', size: 20 })] })
    ]
  });
  const rightChildren = [];
  if (logo) {
    rightChildren.push(new Paragraph({
      alignment: AlignmentType.RIGHT, spacing: { before: 0, after: 3200 },
      children: [new ImageRun({ type: 'png', data: logo, transformation: { width: 204, height: 44 }, altText: { title: 'Logo', description: `${r.meta.brandName} logo`, name: 'logo' } })]
    }));
  }
  rightChildren.push(
    new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { after: 0 }, children: [new TextRun({ text: 'AML/CTF', size: 68, font: HEADING_FONT })] }),
    new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { after: 600 }, children: [new TextRun({ text: 'External Review Report', size: 68, font: HEADING_FONT })] }),
    new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { after: 120 }, children: [new TextRun({ text: r.entity.legalName || '', size: 32, bold: true })] }),
    new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { after: 120 }, children: [new TextRun({ text: r.entity.entityTypeLine || '', size: 22 })] }),
    new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { before: 400, after: 0 }, children: [new TextRun({ text: 'Independent External Review of the AML/CTF Compliance Program', size: 22, italics: true })] }),
    new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { after: 0 }, children: [new TextRun({ text: `As at ${r.meta.asAtLabel}`, size: 22 })] })
  );
  const rightCell = new TableCell({
    width: { size: COVER_WIDTH - bandWidth, type: WidthType.DXA },
    verticalAlign: VerticalAlign.TOP,
    margins: { top: 1440, bottom: 400, left: 600, right: 0 },
    borders: noBorders(),
    children: rightChildren
  });
  return new Table({
    width: { size: COVER_WIDTH, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: [bandWidth, COVER_WIDTH - bandWidth],
    rows: [new TableRow({ height: { value: COVER.rowHeight, rule: 'exact' }, children: [bandCell, rightCell] })]
  });
}

// ---- Business profile table ------------------------------------------------
// Borderless, bold first column, single-spaced cells — as in the sample.
function profileTable(rows) {
  const col1 = 2738, col2 = CONTENT_WIDTH - 2738;
  const cell = (text, { bold = false, width }) => new TableCell({
    width: { size: width, type: WidthType.DXA },
    margins: { top: 40, bottom: 40, left: 60, right: 60 },
    borders: noBorders(),
    children: [new Paragraph({ spacing: SINGLE, children: [new TextRun({ text: String(text || ''), bold })] })]
  });
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: [col1, col2],
    rows: [
      new TableRow({ tableHeader: true, children: [cell('Business Information', { bold: true, width: col1 }), cell('Details', { bold: true, width: col2 })] }),
      ...rows.map(row => new TableRow({ children: [cell(row.label, { bold: true, width: col1 }), cell(row.value, { width: col2 })] }))
    ]
  });
}

// ---- Draft notes box (only when something needs the auditor's eye) --------
// Not part of the issued format — appears only when a stage could not be
// completed, so the reviewer sees it before sign-off, and is removed then.
function draftNotes(warnings) {
  if (!warnings || !warnings.length) return [];
  const rule = { style: BorderStyle.SINGLE, size: 6, color: '9A9A96' };
  return [
    blank(), blank(),
    new Table({
      width: { size: CONTENT_WIDTH, type: WidthType.DXA },
      layout: TableLayoutType.FIXED,
      columnWidths: [CONTENT_WIDTH],
      rows: [new TableRow({ children: [new TableCell({
        width: { size: CONTENT_WIDTH, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: 'F2F2F0', color: 'auto' },
        borders: { top: rule, bottom: rule, left: rule, right: rule },
        margins: { top: 160, bottom: 160, left: 200, right: 200 },
        children: [
          new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: 'DRAFT NOTES — remove before issue', bold: true, size: 20 })] }),
          ...warnings.map(w => new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: `• ${w}`, size: 20 })] }))
        ]
      })] })]
    })
  ];
}

// ---- Document --------------------------------------------------------------
function buildDocument(r) {
  const logo = readAsset(LOGO);
  const signature = readAsset(SIGNATURE);

  const children = [
    // Title block — centred, as in the sample.
    heading('INDEPENDENT EXTERNAL REVIEW REPORT', HeadingLevel.HEADING_1, { center: true }),
    heading('Anti-Money Laundering and Counter-Terrorism Financing Compliance Program', HeadingLevel.HEADING_2, { center: true, size: 28 }),
    runs([{ text: r.entity.legalName || '', bold: true, size: 27 }], { align: AlignmentType.CENTER }),
    ...(r.entity.entityTypeLine ? [runs([{ text: r.entity.entityTypeLine, bold: true }], { align: AlignmentType.CENTER })] : []),
    blank(),

    heading('1. Executive Summary', HeadingLevel.HEADING_3, { bold: true, spacingAfter: 0 }),
    ...paras(r.executiveSummary),
    ...assessmentLines(r),
    blank(),

    heading('2. Business Profile', HeadingLevel.HEADING_3, { bold: true }),
    profileTable(r.businessProfile),
    blank(),
    heading('Business Overview', HeadingLevel.HEADING_4, { bold: true }),
    ...paras(r.businessOverview),

    heading('3. Scope and Methodology', HeadingLevel.HEADING_3, { bold: true }),
    heading('3.1 Scope of the Review', HeadingLevel.HEADING_3),
    ...paras(r.scope.scopeParagraphs),
    heading('3.2 Review Methodology', HeadingLevel.HEADING_3),
    ...paras(r.scope.methodologyParagraphs),
    heading('3.3 Areas Reviewed', HeadingLevel.HEADING_3),
    body('The review assessed the effectiveness of the following key components of the AML/CTF framework:', { keepNext: true }),
    ...r.scope.areasReviewed.map(a => bullet(a)),
    blank(),
    heading('3.4 Review Limitations', HeadingLevel.HEADING_3),
    ...paras(r.scope.limitationsParagraphs),

    heading('4. DETAILED COMPLIANCE REVIEW', HeadingLevel.HEADING_2, { bold: true })
  ];

  for (const s of r.detailedReview) {
    children.push(
      heading(`${s.letter}. ${s.title}`, HeadingLevel.HEADING_3),
      heading('Requirement', HeadingLevel.HEADING_4),
      body(s.requirement),
      heading('Auditor Observation', HeadingLevel.HEADING_4),
      body(s.observation),
      blank()
    );
  }

  children.push(
    heading('5. Opportunities for Improvement', HeadingLevel.HEADING_2, { bold: true }),
    ...(r.opportunities.intro ? para(r.opportunities.intro) : []),
    ...r.opportunities.items.map(i => bullet(i, { justify: true })),
    blank(),

    heading('6. Key Strengths', HeadingLevel.HEADING_2, { bold: true }),
    ...paras(r.keyStrengths),

    heading('7. Key Red Flags', HeadingLevel.HEADING_2, { bold: true }),
    ...paras(r.keyRedFlags),

    heading('8. Overall Conclusion', HeadingLevel.HEADING_2, { bold: true }),
    ...paras(r.overallConclusion),
    ...assessmentLines(r, { keepNext: true }),
    blank({ keepNext: true })
  );

  // Signature block — kept on one page with the closing assessment lines.
  if (signature) {
    children.push(new Paragraph({
      spacing: SINGLE, keepNext: true, keepLines: true,
      children: [new ImageRun({ type: 'png', data: signature, transformation: { width: 151, height: 151 }, altText: { title: 'Signature', description: 'Reviewer signature mark', name: 'signature' } })]
    }));
  }
  children.push(
    new Paragraph({ spacing: SINGLE, keepNext: true, keepLines: true, children: [new TextRun({ text: `Conducted by ${r.meta.auditorName}${r.meta.auditorCredentials ? ` ${r.meta.auditorCredentials}` : ''}` })] }),
    new Paragraph({ spacing: SINGLE, keepLines: true, children: [new TextRun({ text: `Electronically concluded on ${r.meta.concludedLabel}.` })] }),
    ...draftNotes(r.warnings)
  );

  return new Document({
    creator: r.meta.brandName || 'Centinl',
    title: 'External Review Report',
    description: `Independent external review of the AML/CTF compliance program of ${r.entity.legalName || 'the entity'}`,
    styles: {
      default: {
        // Word's own defaults in the sample: 12pt, 8pt after, 1.16 lines —
        // body paragraphs then override to single/none, exactly as above.
        document: { run: { font: BODY_FONT, size: 24 }, paragraph: { spacing: { after: 160, line: 278 } } }
      },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font: HEADING_FONT, size: 40, color: HEADING_COLOR }, paragraph: { spacing: { before: 360, after: 80 }, keepNext: true, keepLines: true, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font: HEADING_FONT, size: 32, color: HEADING_COLOR }, paragraph: { spacing: { before: 160, after: 80 }, keepNext: true, keepLines: true, outlineLevel: 1 } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font: BODY_FONT, size: 28, color: HEADING_COLOR }, paragraph: { spacing: { before: 160, after: 80 }, keepNext: true, keepLines: true, outlineLevel: 2 } },
        { id: 'Heading4', name: 'Heading 4', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font: BODY_FONT, size: 24, italics: true, color: HEADING_COLOR }, paragraph: { spacing: { before: 80, after: 40 }, keepNext: true, keepLines: true, outlineLevel: 3 } }
      ]
    },
    numbering: {
      config: [{
        reference: 'bullets',
        levels: [{ level: 0, format: LevelFormat.BULLET, text: '\uF0B7', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } }, run: { font: 'Symbol' } } }]
      }]
    },
    sections: [{
      // Cover: full-bleed band, no footer.
      properties: {
        page: { size: { width: PAGE.width, height: PAGE.height }, margin: { top: 0, right: COVER.marginRight, bottom: 0, left: 0, header: 0, footer: 0 } }
      },
      children: [coverPage(r, logo)]
    }, {
      properties: {
        page: { size: { width: PAGE.width, height: PAGE.height }, margin: { top: PAGE.margin, right: PAGE.margin, bottom: PAGE.margin, left: PAGE.margin } }
      },
      footers: {
        default: new Footer({ children: [new Paragraph({
          spacing: SINGLE,
          children: [
            new TextRun({ text: 'Page ', color: FOOTER_COLOR }),
            new TextRun({ children: [PageNumber.CURRENT], color: FOOTER_COLOR }),
            new TextRun({ text: ' of ', color: FOOTER_COLOR }),
            new TextRun({ children: [PageNumber.TOTAL_PAGES], color: FOOTER_COLOR })
          ]
        })] })
      },
      children
    }]
  });
}

async function renderDocx(report) {
  return Packer.toBuffer(buildDocument(report));
}

// <Entity>_ExternalReview_Report_<year>[_vN].docx — the naming the issued
// reports use, with the version suffix once a contact has more than one.
function docxFileName(report, version) {
  const base = String(report.entity?.legalName || 'Entity').replace(/\s+(pty\.?\s+ltd\.?|limited|ltd\.?)$/i, '').replace(/[^A-Za-z0-9]+/g, '').slice(0, 40) || 'Entity';
  const v = version ? `_v${version}` : '';
  return `${base}_ExternalReview_Report_${report.meta?.year || new Date().getFullYear()}${v}.docx`;
}

module.exports = { renderDocx, docxFileName, buildDocument };
