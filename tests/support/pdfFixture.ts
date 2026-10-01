/**
 * Minimal PDF byte generator for tests.
 *
 * Produces structurally real PDF bytes â€” object table, catalog, page tree, info
 * dictionary, optional outline, optional encryption â€” so the parser and import
 * pipeline are exercised against actual PDF syntax rather than a mock.
 *
 * Test-only. Never imported by application code.
 */

import { latin1Encode } from './memoryStorage';

export interface PdfFixtureOptions {
  title?: string;
  author?: string;
  subject?: string;
  version?: string;
  pageCount?: number;
  /** Adds `/Encrypt` to the trailer, as a protected file has. */
  encrypted?: boolean;
  /** Emit a file whose page tree points at itself, to test cycle handling. */
  cyclicPageTree?: boolean;
  /** Add outline entries with destinations. */
  outline?: { title: string; pageIndex: number; children?: { title: string; pageIndex: number }[] }[];
  /** Drop the trailer entirely, as a truncated file has. */
  omitTrailer?: boolean;
  /** Replace the header so the file is not a PDF at all. */
  corruptHeader?: boolean;
  /** Media box in points. */
  mediaBox?: [number, number, number, number];
}

export function buildPdfBytes(options: PdfFixtureOptions = {}): Uint8Array {
  const pageCount = Math.max(1, options.pageCount ?? 3);
  const box = options.mediaBox ?? [0, 0, 595, 842];

  // Object numbering: 1 = catalog, 2 = page tree, 3 = info, 4 = content,
  // 10..10+n = pages, 30 = outlines root, 31+ = outline items.
  const firstPageObj = 10;
  const pageRefs = Array.from({ length: pageCount }, (_, i) => firstPageObj + i);
  const outlineObj = 30;

  const kids = pageRefs.map((ref) => `${ref} 0 R`).join(' ');
  const pageEntries = pageRefs
    .map(
      (ref) =>
        `${ref} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [${box.join(' ')}] /Contents 4 0 R >>\nendobj\n`,
    )
    .join('');

  // The root object number must match the one the catalog's /Outlines points at.
  const outline = buildOutline(options.outline ?? [], outlineObj, pageRefs);

  const parts: string[] = [];

  parts.push(options.corruptHeader ? 'NOT-A-PDF-1.4\n' : `%PDF-${options.version ?? '1.7'}\n`);
  parts.push('%\xE2\xE3\xCF\xD3\n'); // binary marker so text tools ignore the file

  parts.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R${outline ? ` /Outlines ${outlineObj} 0 R` : ''} /PageMode /UseOutlines >>\nendobj\n`);

  if (options.cyclicPageTree) {
    // /Kids points back at the node itself: a genuine malformed loop.
    parts.push(`2 0 obj\n<< /Type /Pages /Kids [2 0 R] /Count 1 >>\nendobj\n`);
  } else {
    parts.push(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>\nendobj\n`);
  }

  const infoEntries = [
    options.title ? ` /Title (${escapePdfString(options.title)})` : '',
    options.author ? ` /Author (${escapePdfString(options.author)})` : '',
    options.subject ? ` /Subject (${escapePdfString(options.subject)})` : '',
  ].join('');
  parts.push(`3 0 obj\n<<${infoEntries} /Producer (LifeOS tests) >>\nendobj\n`);

  parts.push(`4 0 obj\n<< /Length 44 >>\nstream\nBT /F1 12 Tf 72 720 Td (Hello) Tj ET\nendstream\nendobj\n`);

  // With a cyclic tree the page objects are unreachable from the tree, which is the
  // point of that fixture; with a healthy tree they are what the tree points at.
  parts.push(pageEntries);

  if (outline) parts.push(outline);

  if (!options.omitTrailer) {
    parts.push(
      `trailer\n<< /Size 40 /Root 1 0 R /Info 3 0 R${options.encrypted ? ' /Encrypt 9 0 R' : ''} >>\nstartxref\n0\n%%EOF\n`,
    );
  }

  return concat(parts.map(latin1Encode));
}

/** Serialises outline items into linked `/First` / `/Next` objects. */
interface OutlineNode {
  title: string;
  pageIndex: number;
  children?: OutlineNode[];
}

/**
 * Serialises outline items into linked `/First` / `/Next` objects.
 *
 * Two passes, on purpose: numbers are allocated for the whole tree first, and only
 * then are the sibling and child links emitted. Allocating and emitting in one pass
 * interleaves parent and child objects, which silently breaks the `/Next` chain.
 */
function buildOutline(items: OutlineNode[], rootObj: number, pageRefs: number[]): string | null {
  if (items.length === 0) return null;

  // Object rootObj is the Outlines dictionary itself; items start after it.
  let nextObj = rootObj + 1;

  interface Allocated {
    item: OutlineNode;
    objRef: number;
    children: Allocated[];
  }

  const assign = (list: OutlineNode[]): Allocated[] =>
    list.map((item) => {
      const objRef = nextObj;
      nextObj += 1;
      return {
        item,
        objRef,
        children: item.children?.length ? assign(item.children) : [],
      };
    });

  const tree = assign(items);
  const bodies: string[] = [];

  const emit = (nodes: Allocated[]): void => {
    nodes.forEach((node, index) => {
      const nextRef = index + 1 < nodes.length ? nodes[index + 1]?.objRef ?? null : null;
      const firstRef = node.children.length ? node.children[0]?.objRef ?? null : null;
      const pageRef = pageRefs[Math.min(node.item.pageIndex, pageRefs.length - 1)] ?? 0;

      const childLink = firstRef === null ? '' : ` /First ${firstRef} 0 R /Count ${node.children.length}`;
      const nextLink = nextRef === null ? '' : ` /Next ${nextRef} 0 R`;

      bodies.push(
        `${node.objRef} 0 obj\n<< /Title (${escapePdfString(node.item.title)}) /Dest [${pageRef} 0 R /XYZ 0 842 0]${childLink}${nextLink} >>\nendobj\n`,
      );
      if (node.children.length > 0) emit(node.children);
    });
  };

  emit(tree);

  const firstRef = tree[0]?.objRef ?? rootObj + 1;
  const lastRef = tree[tree.length - 1]?.objRef ?? firstRef;

  return `${rootObj} 0 obj\n<< /Type /Outlines /First ${firstRef} 0 R /Last ${lastRef} 0 R /Count ${items.length} >>\nendobj\n${bodies.join('')}`;
}

function escapePdfString(value: string): string {
  return value.replace(/([\\()])/g, '\\$1');
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
