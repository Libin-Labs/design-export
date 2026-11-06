export interface ShapeBase {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly fill: string;
  readonly opacity?: number;
}
export interface Rectangle extends ShapeBase {
  readonly kind: 'rect';
  readonly width: number;
  readonly height: number;
}
export interface Ellipse extends ShapeBase {
  readonly kind: 'ellipse';
  readonly radiusX: number;
  readonly radiusY: number;
}
export interface TextNode extends ShapeBase {
  readonly kind: 'text';
  readonly text: string;
  readonly fontFamily: string;
  readonly fontSize: number;
}
export type DesignNode = Rectangle | Ellipse | TextNode;
export interface DesignDocument {
  readonly width: number;
  readonly height: number;
  readonly nodes: readonly DesignNode[];
}
export interface ExportLimits {
  readonly maxNodes?: number;
  readonly maxOutputBytes?: number;
  readonly availableFonts?: readonly string[];
}
export interface Readiness {
  readonly ready: boolean;
  readonly missingFonts: readonly string[];
}
export type RasterFormat = 'png' | 'jpeg';
export type RasterExporter = (
  document: DesignDocument,
  format: RasterFormat,
  signal?: AbortSignal,
) => Promise<{ readonly mediaType: 'image/png' | 'image/jpeg'; readonly data: Uint8Array }>;
export interface ExportOptions extends ExportLimits {
  readonly rasterExporter?: RasterExporter;
  readonly signal?: AbortSignal;
}
export type DesignOutput =
  | { readonly format: 'svg'; readonly mediaType: 'image/svg+xml'; readonly data: string }
  | {
      readonly format: RasterFormat;
      readonly mediaType: 'image/png' | 'image/jpeg';
      readonly data: Uint8Array;
    };

export class DesignExportError extends Error {
  constructor(
    readonly code: 'invalid' | 'capacity' | 'not-ready' | 'unsupported' | 'cancelled' | 'adapter',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'DesignExportError';
  }
}

function bounded(value: number, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new DesignExportError('invalid', `${name} must be finite in ${min}..${max}.`);
  return value;
}
function integer(value: number, name: string, max: number): number {
  bounded(value, name, 1, max);
  if (!Number.isSafeInteger(value))
    throw new DesignExportError('invalid', `${name} must be an integer.`);
  return value;
}
function xmlText(value: string, name: string, limit: number): string {
  if (typeof value !== 'string' || value.length > limit)
    throw new DesignExportError('invalid', `${name} must be text up to ${limit} characters.`);
  // XML 1.0 excludes controls, isolated surrogates and U+FFFE/U+FFFF.
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if (
      (point < 32 && point !== 9 && point !== 10 && point !== 13) ||
      (point >= 0xd800 && point <= 0xdfff) ||
      point === 0xfffe ||
      point === 0xffff
    )
      throw new DesignExportError('invalid', `${name} contains an invalid XML character.`);
  }
  return value;
}
function font(value: string): string {
  if (typeof value !== 'string' || value.length > 128 || !/^[A-Za-z][A-Za-z0-9 -]*$/u.test(value))
    throw new DesignExportError('invalid', 'Font family must be a single simple family name.');
  return value;
}
function limits(options: ExportLimits) {
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw new DesignExportError('invalid', 'Options must be an object.');
  const maxNodes = integer(
    options.maxNodes === undefined ? 1000 : options.maxNodes,
    'maxNodes',
    10_000,
  );
  const maxOutputBytes = integer(
    options.maxOutputBytes === undefined ? 1_048_576 : options.maxOutputBytes,
    'maxOutputBytes',
    67_108_864,
  );
  const fonts = options.availableFonts === undefined ? [] : options.availableFonts;
  if (!Array.isArray(fonts) || fonts.length > 256)
    throw new DesignExportError('invalid', 'availableFonts must contain at most 256 families.');
  const available = new Set<string>();
  for (const item of fonts) available.add(font(item));
  return { maxNodes, maxOutputBytes, available };
}
function prepare(document: DesignDocument, maxNodes: number): DesignDocument {
  if (!document || typeof document !== 'object')
    throw new DesignExportError('invalid', 'A design document is required.');
  const width = bounded(document.width, 'width', 1, 16_384);
  const height = bounded(document.height, 'height', 1, 16_384);
  if (!Array.isArray(document.nodes))
    throw new DesignExportError('invalid', 'nodes must be an array.');
  if (document.nodes.length > maxNodes)
    throw new DesignExportError('capacity', 'Node capacity exceeded.');
  const ids = new Set<string>();
  const nodes: DesignNode[] = [];
  for (const node of document.nodes) {
    if (!node || typeof node !== 'object')
      throw new DesignExportError('invalid', 'Each node must be a primitive.');
    const id = xmlText(node.id, 'ID', 128);
    if (!id.trim() || ids.has(id))
      throw new DesignExportError('invalid', 'IDs must be nonempty and unique.');
    ids.add(id);
    const x = bounded(node.x, 'x', -1_000_000, 1_000_000);
    const y = bounded(node.y, 'y', -1_000_000, 1_000_000);
    if (
      typeof node.fill !== 'string' ||
      !/^(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|none)$/u.test(node.fill)
    )
      throw new DesignExportError('invalid', 'fill must be #RRGGBB, #RRGGBBAA or none.');
    const opacity = bounded(node.opacity === undefined ? 1 : node.opacity, 'opacity', 0, 1);
    const base = { id, x, y, fill: node.fill, opacity };
    switch (node.kind) {
      case 'rect':
        nodes.push(
          Object.freeze({
            ...base,
            kind: 'rect',
            width: bounded(node.width, 'node width', 0, 1_000_000),
            height: bounded(node.height, 'node height', 0, 1_000_000),
          }),
        );
        break;
      case 'ellipse':
        nodes.push(
          Object.freeze({
            ...base,
            kind: 'ellipse',
            radiusX: bounded(node.radiusX, 'radiusX', 0, 1_000_000),
            radiusY: bounded(node.radiusY, 'radiusY', 0, 1_000_000),
          }),
        );
        break;
      case 'text':
        nodes.push(
          Object.freeze({
            ...base,
            kind: 'text',
            text: xmlText(node.text, 'text', 16_384),
            fontFamily: font(node.fontFamily),
            fontSize: bounded(node.fontSize, 'fontSize', 1, 4096),
          }),
        );
        break;
      default:
        throw new DesignExportError(
          'unsupported',
          'Only rect, ellipse and text nodes are supported.',
        );
    }
  }
  return Object.freeze({ width, height, nodes: Object.freeze(nodes) });
}
function readiness(document: DesignDocument, available: Set<string>): Readiness {
  const missing = new Set<string>();
  for (const node of document.nodes)
    if (node.kind === 'text' && !available.has(node.fontFamily)) missing.add(node.fontFamily);
  return Object.freeze({ ready: missing.size === 0, missingFonts: Object.freeze([...missing]) });
}
function requireReady(document: DesignDocument, available: Set<string>): void {
  const result = readiness(document, available);
  if (!result.ready)
    throw new DesignExportError(
      'not-ready',
      `Fonts not declared ready: ${result.missingFonts.join(', ')}.`,
    );
}
function escape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
function svg(document: DesignDocument, maxBytes: number): string {
  let output = `<svg xmlns="http://www.w3.org/2000/svg" width="${document.width}" height="${document.height}" viewBox="0 0 ${document.width} ${document.height}">`;
  let bytes = new TextEncoder().encode(output).byteLength;
  for (const node of document.nodes) {
    const attrs = `id="${escape(node.id)}" fill="${node.fill}" opacity="${node.opacity}"`;
    let element: string;
    switch (node.kind) {
      case 'rect':
        element = `<rect ${attrs} x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}"/>`;
        break;
      case 'ellipse':
        element = `<ellipse ${attrs} cx="${node.x}" cy="${node.y}" rx="${node.radiusX}" ry="${node.radiusY}"/>`;
        break;
      case 'text':
        element = `<text ${attrs} x="${node.x}" y="${node.y}" font-family="${escape(node.fontFamily)}" font-size="${node.fontSize}">${escape(node.text)}</text>`;
        break;
    }
    bytes += new TextEncoder().encode(element).byteLength;
    if (bytes + 6 > maxBytes)
      throw new DesignExportError('capacity', 'SVG exceeds maxOutputBytes.');
    output += element;
  }
  if (bytes + 6 > maxBytes) throw new DesignExportError('capacity', 'SVG exceeds maxOutputBytes.');
  return `${output}</svg>`;
}
function signalCheck(signal: AbortSignal | undefined): void {
  if (
    signal !== undefined &&
    (!signal ||
      typeof signal.aborted !== 'boolean' ||
      typeof signal.addEventListener !== 'function')
  )
    throw new DesignExportError('invalid', 'signal must be an AbortSignal.');
  if (signal?.aborted)
    throw new DesignExportError('cancelled', 'Export cancelled; no output is returned.');
}

export function checkReadiness(document: DesignDocument, options: ExportLimits = {}): Readiness {
  const config = limits(options);
  return readiness(prepare(document, config.maxNodes), config.available);
}
export function exportSvg(document: DesignDocument, options: ExportLimits = {}): string {
  const config = limits(options);
  const prepared = prepare(document, config.maxNodes);
  requireReady(prepared, config.available);
  return svg(prepared, config.maxOutputBytes);
}
export async function exportDesign(
  document: DesignDocument,
  format: 'svg' | RasterFormat,
  options: ExportOptions = {},
): Promise<DesignOutput> {
  const config = limits(options);
  const signal = options.signal;
  const adapter = options.rasterExporter;
  signalCheck(signal);
  const prepared = prepare(document, config.maxNodes);
  requireReady(prepared, config.available);
  if (format === 'svg')
    return Object.freeze({
      format,
      mediaType: 'image/svg+xml',
      data: svg(prepared, config.maxOutputBytes),
    });
  if (format !== 'png' && format !== 'jpeg')
    throw new DesignExportError(
      'unsupported',
      'Only SVG, PNG and JPEG are supported; PDF is not encoded.',
    );
  if (typeof adapter !== 'function')
    throw new DesignExportError(
      'unsupported',
      'PNG/JPEG require an explicit rasterExporter adapter.',
    );
  let result: Awaited<ReturnType<RasterExporter>>;
  try {
    result = await adapter(prepared, format, signal);
  } catch (cause) {
    signalCheck(signal);
    throw new DesignExportError('adapter', 'Raster exporter failed.', { cause });
  }
  signalCheck(signal);
  const expected = format === 'png' ? 'image/png' : 'image/jpeg';
  if (
    !result ||
    result.mediaType !== expected ||
    !(result.data instanceof Uint8Array) ||
    result.data.byteLength === 0
  )
    throw new DesignExportError(
      'adapter',
      'Adapter must return nonempty bytes with the requested MIME type.',
    );
  if (result.data.byteLength > config.maxOutputBytes)
    throw new DesignExportError('capacity', 'Raster output exceeds maxOutputBytes.');
  return Object.freeze({ format, mediaType: expected, data: new Uint8Array(result.data) });
}
