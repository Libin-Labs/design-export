import { checkReadiness, exportSvg, exportDesign, DesignExportError } from '@lp-labs/design-export';
import type {
  ShapeBase,
  Rectangle,
  Ellipse,
  TextNode,
  DesignNode,
  DesignDocument,
  ExportLimits,
  Readiness,
  RasterFormat,
  RasterExporter,
  ExportOptions,
  DesignOutput,
} from '@lp-labs/design-export';
const base: ShapeBase = { id: 'a', x: 0, y: 0, fill: '#000000' };
const rectangle: Rectangle = { ...base, kind: 'rect', width: 1, height: 1 };
const ellipse: Ellipse = { ...base, id: 'b', kind: 'ellipse', radiusX: 1, radiusY: 1 };
const text: TextNode = {
  ...base,
  id: 'c',
  kind: 'text',
  text: 'Hi',
  fontFamily: 'Arial',
  fontSize: 12,
};
const nodes: DesignNode[] = [rectangle, ellipse, text];
const document: DesignDocument = { width: 100, height: 100, nodes };
const limits: ExportLimits = { availableFonts: ['Arial'] };
const readiness: Readiness = checkReadiness(document, limits);
const format: RasterFormat = 'png';
const adapter: RasterExporter = async () => ({ mediaType: 'image/png', data: new Uint8Array([1]) });
const options: ExportOptions = { ...limits, rasterExporter: adapter };
const output: Promise<DesignOutput> = exportDesign(document, format, options);
void [readiness, output, exportSvg(document, limits), new DesignExportError('invalid', 'invalid')];
// @ts-expect-error PDF is not encoded
void exportDesign(document, 'pdf');
