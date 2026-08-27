import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, VerticalAlign,
} from 'docx';
import { fetchDeptRecords, applyGeoScope } from './records.js';
import { DEPT_NAME_FIELD } from './sections.js';
import { licenseExpiryInfo } from './jalali.js';
import { sb } from './supabase.js';
import { fetchAllUsers } from './users.js';

const FONT = 'Arial';
const RTL = true;
const DEPTS = ['معدن', 'صنعت', 'اکتشاف', 'فرآوری', 'اصناف'];
const DEPT_ICON = {
  معدن: '⛏️', صنعت: '🏭', اکتشاف: '🔍', فرآوری: '⚗️', اصناف: '🏪',
};

function p(text, opts = {}) {
  const {
    bold = false, size = 22, color, spacingAfter = 140,
  } = opts;
  return new Paragraph({
    alignment: AlignmentType.RIGHT,
    bidirectional: RTL,
    spacing: { after: spacingAfter, line: 300 },
    children: [new TextRun({
      text, bold, size, color, font: FONT, rightToLeft: RTL,
    })],
  });
}

function heading(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    alignment: AlignmentType.RIGHT,
    bidirectional: RTL,
    spacing: { before: 320, after: 160 },
    children: [new TextRun({
      text, bold: true, size: 27, color: '1F3D2B', font: FONT, rightToLeft: RTL,
    })],
  });
}

function cell(text, opts = {}) {
  const {
    width, bold = false, shade, size = 20,
  } = opts;
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: shade ? { type: ShadingType.CLEAR, fill: shade } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    margins: {
      top: 90, bottom: 90, left: 110, right: 110,
    },
    children: [new Paragraph({
      alignment: AlignmentType.RIGHT,
      bidirectional: RTL,
      children: [new TextRun({
        text, bold, size, font: FONT, rightToLeft: RTL,
      })],
    })],
  });
}

function kpiTable(rows) {
  const w1 = 5400; const w2 = 2600;
  return new Table({
    width: { size: w1 + w2, type: WidthType.DXA },
    rows: [
      new TableRow({
        children: [
          cell('شاخص', { width: w1, bold: true, shade: '2E5B3F', size: 20 }),
          cell('تعداد', { width: w2, bold: true, shade: '2E5B3F', size: 20 }),
        ],
      }),
      ...rows.map(([label, val], i) => new TableRow({
        children: [
          cell(label, { width: w1, shade: i % 2 ? 'F2F6F3' : 'FFFFFF' }),
          cell(String(val), { width: w2, shade: i % 2 ? 'F2F6F3' : 'FFFFFF' }),
        ],
      })),
    ],
  });
}

async function collectStats(assignedProvince, assignedCounty) {
  const perDept = {};
  for (const dept of DEPTS) {
    // eslint-disable-next-line no-await-in-loop
    let list = await fetchDeptRecords(dept, {}).catch(() => []);
    list = applyGeoScope(list, assignedProvince, assignedCounty);
    const nameField = DEPT_NAME_FIELD[dept] || 'نام_معدن';
    const withExpiry = list.map((m) => ({ m, info: licenseExpiryInfo(m, dept) })).filter((x) => x.info);
    const expired = withExpiry.filter((x) => x.info.expired);
    const soon = withExpiry.filter((x) => !x.info.expired && x.info.monthsLeft <= 3);
    perDept[dept] = {
      nameField, total: list.length, expired, soon,
    };
  }

  const [correctiveRes, incidentRes, equipRes, usersRes] = await Promise.all([
    sb.from('corrective_actions').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    sb.from('incident_reports').select('id', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
    sb.from('mine_equipment').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    fetchAllUsers().catch(() => ({ pending: [] })),
  ]);

  return {
    perDept,
    correctiveOpen: correctiveRes.count || 0,
    incidents30d: incidentRes.count || 0,
    equipmentPending: equipRes.count || 0,
    usersPending: (usersRes.pending || []).length,
  };
}

/**
 * گزارش دوره‌ای وضعیت سامانه را با آمار واقعی و به‌روز از دیتابیس می‌سازد و یک Blob فایل Word
 * برمی‌گرداند. برخلاف گزارش معرفی سامانه (که یک‌بار با دست نوشته شد)، این گزارش هر بار که
 * صدا زده شود، دوباره از پایگاه‌داده می‌خواند — یعنی همیشه آمار همان لحظه را نشان می‌دهد.
 */
export async function generatePeriodicReport({ assignedProvince, assignedCounty, orgLabel = 'اداره صنعت، معدن و تجارت شهرستان قروه' } = {}) {
  const stats = await collectStats(assignedProvince, assignedCounty);
  const today = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'full' }).format(new Date());

  const totalRecords = Object.values(stats.perDept).reduce((n, d) => n + d.total, 0);
  const totalExpired = Object.values(stats.perDept).reduce((n, d) => n + d.expired.length, 0);
  const totalSoon = Object.values(stats.perDept).reduce((n, d) => n + d.soon.length, 0);

  const children = [
    new Paragraph({
      alignment: AlignmentType.CENTER, bidirectional: RTL, spacing: { after: 60 },
      children: [new TextRun({
        text: 'گزارش دوره‌ای وضعیت سامانه «سامت»', bold: true, size: 34, color: '1F3D2B', font: FONT, rightToLeft: RTL,
      })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER, bidirectional: RTL, spacing: { after: 40 },
      children: [new TextRun({
        text: orgLabel, size: 22, color: '555555', font: FONT, rightToLeft: RTL,
      })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER, bidirectional: RTL, spacing: { after: 300 },
      children: [new TextRun({
        text: `تاریخ تهیه‌ی گزارش: ${today}`, size: 20, italics: true, color: '777777', font: FONT, rightToLeft: RTL,
      })],
    }),

    heading('خلاصه‌ی کلی'),
    kpiTable([
      ['تعداد کل پروانه‌های ثبت‌شده (همه‌ی بخش‌ها)', totalRecords],
      ['پروانه‌های منقضی‌شده', totalExpired],
      ['پروانه‌های نزدیک به انقضا (تا ۳ ماه)', totalSoon],
      ['اقدام اصلاحی باز', stats.correctiveOpen],
      ['حادثه‌ی ثبت‌شده (۳۰ روز اخیر)', stats.incidents30d],
      ['ماشین‌آلات در انتظار تایید', stats.equipmentPending],
      ['کاربر در انتظار تایید', stats.usersPending],
    ]),

    heading('وضعیت هر بخش'),
    ...DEPTS.flatMap((dept) => {
      const d = stats.perDept[dept];
      const lines = [
        p(`${DEPT_ICON[dept]} ${dept}`, { bold: true, size: 24, spacingAfter: 80 }),
        p(`تعداد کل: ${d.total}  |  منقضی‌شده: ${d.expired.length}  |  نزدیک به انقضا: ${d.soon.length}`, { size: 21, spacingAfter: 120 }),
      ];
      if (d.expired.length || d.soon.length) {
        [...d.expired, ...d.soon].slice(0, 10).forEach(({ m, info }) => {
          lines.push(p(
            `• ${m[d.nameField] || '—'} — ${info.expired ? `منقضی‌شده (${Math.abs(info.monthsLeft)} ماه پیش)` : `${info.monthsLeft} ماه تا انقضا`}`,
            { size: 20, spacingAfter: 60, color: info.expired ? '7A2A20' : '8A5A16' },
          ));
        });
      }
      return lines;
    }),
  ];

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: {
            top: 1000, bottom: 1000, left: 1000, right: 1000,
          },
        },
      },
      children,
    }],
  });

  return Packer.toBlob(doc);
}
