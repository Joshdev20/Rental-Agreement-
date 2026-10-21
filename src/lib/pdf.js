'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const schema = require('./agreement-schema');

// US Letter, 72pt per inch.
const PAGE = { width: 612, height: 792 };
const MARGIN = { top: 58, bottom: 62, left: 62, right: 62 };
const CONTENT_WIDTH = PAGE.width - MARGIN.left - MARGIN.right;
const LABEL_WIDTH = 178;
const LINE_GAP = 4;

const COLORS = {
  ink: '#111827',
  muted: '#4b5563',
  faint: '#9ca3af',
  rule: '#d1d5db',
  ruleStrong: '#111827',
  accent: '#1d4ed8',
  band: '#f3f4f6',
};

/**
 * Small flowing-layout helper around PDFKit: tracks a vertical cursor, repeats
 * page furniture, and keeps headings with the content that follows them.
 */
class Layout {
  constructor(doc, meta) {
    this.doc = doc;
    this.meta = meta;
    this.y = MARGIN.top;
    this.bottom = PAGE.height - MARGIN.bottom;
    this.pageNumber = 1;
  }

  get left() {
    return MARGIN.left;
  }

  get right() {
    return PAGE.width - MARGIN.right;
  }

  space(height) {
    return this.bottom - this.y >= height;
  }

  newPage() {
    this.drawFooter();
    this.doc.addPage();
    this.pageNumber += 1;
    this.y = MARGIN.top;
    this.drawHeaderBand();
  }

  ensure(height) {
    if (!this.space(height)) this.newPage();
  }

  moveDown(amount) {
    this.y += amount;
  }

  drawHeaderBand() {
    if (this.pageNumber === 1) return;
    const doc = this.doc;
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(COLORS.muted)
      .text('RESIDENTIAL RENTAL AGREEMENT', this.left, this.y, { width: CONTENT_WIDTH, align: 'left' });
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(COLORS.faint)
      .text(`Ref ${this.meta.reference}`, this.left, this.y, { width: CONTENT_WIDTH, align: 'right' });
    this.y += 12;
    doc
      .moveTo(this.left, this.y)
      .lineTo(this.right, this.y)
      .lineWidth(0.75)
      .strokeColor(COLORS.rule)
      .stroke();
    this.y += 14;
  }

  drawFooter() {
    const doc = this.doc;
    const y = PAGE.height - MARGIN.bottom + 26;

    // The footer deliberately sits below the text margin. PDFKit inserts a new
    // page whenever text would cross the bottom margin, so the margin is
    // temporarily collapsed while the footer is drawn.
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    doc
      .moveTo(this.left, y - 12)
      .lineTo(this.right, y - 12)
      .lineWidth(0.5)
      .strokeColor(COLORS.rule)
      .stroke();
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(COLORS.faint)
      .text(`Agreement ${this.meta.reference}`, this.left, y - 6, {
        width: CONTENT_WIDTH / 2,
        align: 'left',
        lineBreak: false,
      });
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(COLORS.faint)
      .text(`Page ${this.pageNumber}`, this.left + CONTENT_WIDTH / 2, y - 6, {
        width: CONTENT_WIDTH / 2,
        align: 'right',
        lineBreak: false,
      });

    doc.page.margins.bottom = savedBottom;
  }
}

function drawCoverHeader(layout, meta) {
  const doc = layout.doc;
  const startY = layout.y;

  doc
    .rect(0, 0, PAGE.width, 6)
    .fillColor(COLORS.ruleStrong)
    .fill();

  doc
    .font('Helvetica-Bold')
    .fontSize(20)
    .fillColor(COLORS.ink)
    .text('RESIDENTIAL RENTAL AGREEMENT', layout.left, startY, {
      width: CONTENT_WIDTH,
      align: 'center',
      characterSpacing: 0.4,
    });

  layout.y = doc.y + 6;

  doc
    .font('Helvetica')
    .fontSize(9.5)
    .fillColor(COLORS.muted)
    .text(
      `Executed under the laws of the State of ${meta.governingStateName || meta.governingState || '________'}`,
      layout.left,
      layout.y,
      { width: CONTENT_WIDTH, align: 'center' }
    );
  layout.y = doc.y + 10;

  doc
    .moveTo(layout.left, layout.y)
    .lineTo(layout.right, layout.y)
    .lineWidth(1.25)
    .strokeColor(COLORS.ruleStrong)
    .stroke();
  layout.y += 14;

  // Reference / date strip.
  const stripY = layout.y;
  const boxHeight = 40;
  doc.rect(layout.left, stripY, CONTENT_WIDTH, boxHeight).fillColor(COLORS.band).fill();
  doc.rect(layout.left, stripY, 3, boxHeight).fillColor(COLORS.accent).fill();

  const third = CONTENT_WIDTH / 3;
  const cells = [
    ['AGREEMENT REFERENCE', meta.reference],
    ['DATE PREPARED', meta.preparedDate],
    ['STATUS', 'Executed - signed by tenant'],
  ];
  cells.forEach(([label, value], index) => {
    const x = layout.left + 14 + index * third;
    doc
      .font('Helvetica-Bold')
      .fontSize(7)
      .fillColor(COLORS.muted)
      .text(label, x, stripY + 8, { width: third - 20 });
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor(COLORS.ink)
      .text(String(value || '-'), x, stripY + 20, { width: third - 20 });
  });

  layout.y = stripY + boxHeight + 18;
}

function drawSectionHeading(layout, title, description) {
  const doc = layout.doc;
  const height = description ? 40 : 26;
  layout.ensure(height + 30);

  doc
    .rect(layout.left, layout.y, CONTENT_WIDTH, description ? 34 : 20)
    .fillColor(COLORS.band)
    .fill();

  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(COLORS.ink)
    .text(title.toUpperCase(), layout.left + 8, layout.y + 5, {
      width: CONTENT_WIDTH - 16,
      characterSpacing: 0.3,
    });

  if (description) {
    doc
      .font('Helvetica-Oblique')
      .fontSize(8)
      .fillColor(COLORS.muted)
      .text(description, layout.left + 8, layout.y + 19, { width: CONTENT_WIDTH - 16 });
  }

  layout.y += (description ? 34 : 20) + 8;
}

function fieldValueText(field, data) {
  return schema.displayValue(field, data[field.name]);
}

function drawFieldRow(layout, field, data) {
  const doc = layout.doc;
  const value = fieldValueText(field, data) || '-';
  const label = `${field.label}`;

  doc.font('Helvetica-Bold').fontSize(9);
  const labelHeight = doc.heightOfString(label, { width: LABEL_WIDTH - 10 });
  doc.font('Helvetica').fontSize(9.5);
  const valueHeight = doc.heightOfString(value, { width: CONTENT_WIDTH - LABEL_WIDTH, lineGap: 1.5 });
  const rowHeight = Math.max(labelHeight, valueHeight) + LINE_GAP + 5;

  layout.ensure(rowHeight);

  const rowTop = layout.y;
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(COLORS.muted)
    .text(label, layout.left, rowTop, { width: LABEL_WIDTH - 10 });
  doc
    .font('Helvetica')
    .fontSize(9.5)
    .fillColor(COLORS.ink)
    .text(value, layout.left + LABEL_WIDTH, rowTop, {
      width: CONTENT_WIDTH - LABEL_WIDTH,
      lineGap: 1.5,
    });

  layout.y = rowTop + rowHeight;
  doc
    .moveTo(layout.left, layout.y - 4)
    .lineTo(layout.right, layout.y - 4)
    .lineWidth(0.4)
    .strokeColor('#e5e7eb')
    .stroke();
}

function drawParagraph(layout, text, options = {}) {
  const doc = layout.doc;
  const size = options.size || 9;
  doc.font(options.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
  const height = doc.heightOfString(text, {
    width: CONTENT_WIDTH,
    lineGap: 2.5,
    align: options.align || 'justify',
  });
  layout.ensure(height + 6);
  doc
    .font(options.bold ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(size)
    .fillColor(options.color || COLORS.ink)
    .text(text, layout.left, layout.y, {
      width: CONTENT_WIDTH,
      lineGap: 2.5,
      align: options.align || 'justify',
    });
  layout.y = doc.y + (options.gap === undefined ? 6 : options.gap);
}

function drawClause(layout, number, title, body) {
  const doc = layout.doc;
  doc.font('Helvetica-Bold').fontSize(9);
  const headingHeight = doc.heightOfString(`${number}. ${title}`, { width: CONTENT_WIDTH });
  doc.font('Helvetica').fontSize(9);
  const bodyHeight = doc.heightOfString(body, { width: CONTENT_WIDTH, lineGap: 2.5 });

  // Keep the heading with at least two lines of its body.
  layout.ensure(headingHeight + Math.min(bodyHeight, 26) + 10);

  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(COLORS.ink)
    .text(`${number}. ${title}`, layout.left, layout.y, { width: CONTENT_WIDTH });
  layout.y = doc.y + 2;

  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(COLORS.ink)
    .text(body, layout.left, layout.y, { width: CONTENT_WIDTH, lineGap: 2.5, align: 'justify' });
  layout.y = doc.y + 7;
}

function drawUtilityTable(layout, data) {
  const landlord = schema.displayValue(schema.fieldByName.get('utilities_landlord'), data.utilities_landlord);
  const tenant = schema.displayValue(schema.fieldByName.get('utilities_tenant'), data.utilities_tenant);

  const rows = [
    ['Paid by landlord', landlord || 'None specified'],
    ['Paid by tenant', tenant || 'None specified'],
  ];

  const doc = layout.doc;
  const colWidth = CONTENT_WIDTH / 2;
  for (const [label, value] of rows) {
    doc.font('Helvetica-Bold').fontSize(9);
    const h1 = doc.heightOfString(label, { width: colWidth - 16 });
    doc.font('Helvetica').fontSize(9.5);
    const h2 = doc.heightOfString(value, { width: colWidth - 16 });
    const height = Math.max(h1, h2, 14) + 12;
    layout.ensure(height);

    doc.rect(layout.left, layout.y, CONTENT_WIDTH, height).fillColor('#fafafa').fill();
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(COLORS.muted)
      .text(label, layout.left + 8, layout.y + 6, { width: colWidth - 16 });
    doc
      .font('Helvetica')
      .fontSize(9.5)
      .fillColor(COLORS.ink)
      .text(value, layout.left + colWidth, layout.y + 6, { width: colWidth - 16 });
    layout.y += height;
  }
  layout.y += 8;
}

function decodeSignature(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:image\/png;base64,(.+)$/);
  if (!match) return null;
  try {
    const buffer = Buffer.from(match[1], 'base64');
    if (buffer.length === 0) return null;
    // Defence in depth: records written before validation existed, or a
    // re-render of older data, must not hand a broken image to PDFKit - its
    // decoder runs during flush and would abort the process instead of the
    // single document.
    if (!schema.isValidPng(buffer)) return null;
    return buffer;
  } catch {
    return null;
  }
}

function drawSignatureBlock(layout, data, meta) {
  const doc = layout.doc;
  const blockHeight = 132;
  layout.ensure(blockHeight + 20);

  doc
    .moveTo(layout.left, layout.y)
    .lineTo(layout.right, layout.y)
    .lineWidth(1)
    .strokeColor(COLORS.ruleStrong)
    .stroke();
  layout.y += 12;

  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(COLORS.ink)
    .text('SIGNATURES', layout.left, layout.y, { width: CONTENT_WIDTH });
  layout.y = doc.y + 8;

  const colWidth = CONTENT_WIDTH / 2 - 14;
  const tenantX = layout.left;
  const landlordX = layout.left + CONTENT_WIDTH / 2 + 14;
  const top = layout.y;

  // Tenant side: embedded handwritten signature image.
  const signature = decodeSignature(data.signature_data);
  const lineY = top + 62;
  if (signature) {
    try {
      doc.image(signature, tenantX, top + 6, {
        fit: [colWidth - 10, 52],
        align: 'left',
        valign: 'bottom',
      });
    } catch {
      /* Unreadable image data should never break the document. */
    }
  }

  doc
    .moveTo(tenantX, lineY)
    .lineTo(tenantX + colWidth, lineY)
    .lineWidth(0.75)
    .strokeColor(COLORS.ink)
    .stroke();
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(COLORS.muted)
    .text(
      `Tenant signature — ${data.printed_name || data.tenant_name || ''}`,
      tenantX,
      lineY + 4,
      { width: colWidth }
    );
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(COLORS.ink)
    .text(`Date signed: ${schema.formatDate(data.signature_date) || '-'}`, tenantX, lineY + 18, {
      width: colWidth,
    });

  // Landlord side: intentionally left blank for a countersignature.
  doc
    .moveTo(landlordX, lineY)
    .lineTo(landlordX + colWidth, lineY)
    .lineWidth(0.75)
    .strokeColor(COLORS.ink)
    .stroke();
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(COLORS.muted)
    .text('Landlord / agent signature', landlordX, lineY + 4, { width: colWidth });
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(COLORS.ink)
    .text(`Date: ____________________`, landlordX, lineY + 18, { width: colWidth });

  layout.y = lineY + 40;
  doc
    .font('Helvetica-Oblique')
    .fontSize(7.5)
    .fillColor(COLORS.faint)
    .text(
      `Electronically submitted through the online rental agreement portal on ${meta.submittedAt}. ` +
        `Reference ${meta.reference}.`,
      layout.left,
      layout.y,
      { width: CONTENT_WIDTH }
    );
  layout.y = doc.y + 6;
}

const STANDARD_CLAUSES = [
  [
    'Use of Premises',
    'The premises shall be used solely as a private residence. Tenant shall not use the premises for any unlawful purpose, nor permit any nuisance, waste, or unreasonable noise that disturbs neighbors or other occupants.',
  ],
  [
    'Utilities and Services',
    'Responsibility for utilities is allocated in Section 5 of this agreement. Tenant shall arrange for transfer or connection of all utilities designated as tenant responsibility on or before the lease start date.',
  ],
  [
    'Maintenance and Repairs',
    'Tenant shall keep the premises clean, safe and in good condition, and shall promptly notify Landlord of any condition requiring repair. Tenant shall not make alterations without prior written consent of Landlord.',
  ],
  [
    'Entry by Landlord',
    'Landlord may enter the premises upon reasonable advance notice as stated in Section 7, except in an emergency, to inspect, make repairs, or show the premises to prospective tenants or purchasers.',
  ],
  [
    'Default and Remedies',
    'If Tenant fails to pay rent when due or breaches any term of this agreement, Landlord may pursue any remedy available under applicable state law, including termination of the tenancy and recovery of amounts owed.',
  ],
  [
    'Security Deposit',
    'The security deposit is held as security for performance of Tenant obligations. Within the period required by applicable state law after termination of tenancy, Landlord shall provide an itemized accounting of any deductions.',
  ],
  [
    'Governing Law',
    'This agreement shall be governed by and construed in accordance with the laws of the governing state identified in this agreement. If any provision is held unenforceable, the remaining provisions remain in effect.',
  ],
  [
    'Entire Agreement',
    'This agreement constitutes the entire understanding between the parties and supersedes prior discussions. Amendments must be in writing and signed by both parties.',
  ],
];

/**
 * Render the executed agreement to a PDF file on disk.
 * @returns {Promise<{path: string, bytes: number}>}
 */
function generateAgreementPdf({ data, meta, outputPath }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: MARGIN,
      bufferPages: true,
      info: {
        Title: `Residential Rental Agreement ${meta.reference}`,
        Author: meta.landlordName || 'Rental Agreement Desk',
        Subject: `Lease for ${meta.propertyAddress || ''}`.trim(),
        Keywords: 'rental agreement, lease, residential, ' + (meta.reference || ''),
        CreationDate: new Date(),
      },
    });

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    const layout = new Layout(doc, meta);
    drawCoverHeader(layout, meta);

    for (const section of schema.sections) {
      drawSectionHeading(layout, section.title, section.description);

      // Utilities get a dedicated two-column table instead of plain rows.
      const isUtilities = section.id === 'utilities';
      for (const field of section.fields) {
        // The signature is reproduced in the signature block, not as a text row.
        if (field.type === 'signature') continue;
        if (isUtilities && (field.name === 'utilities_landlord' || field.name === 'utilities_tenant')) {
          if (field.name === 'utilities_landlord') drawUtilityTable(layout, data);
          continue;
        }
        drawFieldRow(layout, field, data);
      }
      layout.moveDown(10);
    }

    // Standard terms and conditions.
    layout.ensure(60);
    drawSectionHeading(layout, '11. Standard Terms and Conditions', 'Incorporated into and made part of this agreement.');
    for (const [index, [title, body]] of STANDARD_CLAUSES.entries()) {
      drawClause(layout, `11.${index + 1}`, title, body);
    }

    if (String(data.additional_terms || '').trim()) {
      drawParagraph(layout, 'ADDITIONAL TERMS', { bold: true, align: 'left', gap: 3 });
      drawParagraph(layout, String(data.additional_terms).trim(), { align: 'left' });
    }

    drawSignatureBlock(layout, data, meta);
    layout.drawFooter();

    doc.end();
    stream.on('finish', () => {
      resolve({ path: outputPath, bytes: fs.statSync(outputPath).size });
    });
    stream.on('error', reject);
    doc.on('error', reject);
  });
}

module.exports = { generateAgreementPdf, PAGE, MARGIN };
