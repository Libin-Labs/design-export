# @lp-labs/design-export

Real, safely escaped SVG for bounded design primitives, plus **explicit injected** PNG/JPEG exporter adapters. Independent **0.1.0** MIT package, zero runtime/peer dependencies, Node 18+, ESM/CJS and strict TypeScript declarations.

## Install and quickstart

```sh
npm install @lp-labs/design-export
```

```js
import assert from 'node:assert/strict';
import { checkReadiness, exportSvg, exportDesign } from '@lp-labs/design-export';

const document = {
  width: 320,
  height: 180,
  nodes: [
    { kind: 'rect', id: 'background', x: 0, y: 0, width: 320, height: 180, fill: '#ffffff' },
    {
      kind: 'text',
      id: 'title',
      x: 16,
      y: 40,
      text: 'Hello & welcome',
      fontFamily: 'Arial',
      fontSize: 24,
      fill: '#222222',
    },
  ],
};
const options = { availableFonts: ['Arial'] };
assert.equal(checkReadiness(document, options).ready, true);
const svg = exportSvg(document, options);
assert.ok(svg.includes('Hello &amp; welcome'));
assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
const output = await exportDesign(document, 'svg', options);
assert.equal(output.data, svg);
```

## API and types

Runtime exports: **`checkReadiness`**, **`exportSvg`**, **`exportDesign`**, **`DesignExportError`**. CJS: `const { exportSvg } = require('@lp-labs/design-export')`.

| Exported type    | Fields/contract                                                                     |
| ---------------- | ----------------------------------------------------------------------------------- |
| `ShapeBase`      | `id`, `x`, `y`, `fill`, optional `opacity` (default 1).                             |
| `Rectangle`      | Base plus `kind: 'rect'`, `width`, `height`; x/y are top-left.                      |
| `Ellipse`        | Base plus `kind: 'ellipse'`, `radiusX`, `radiusY`; x/y are center.                  |
| `TextNode`       | Base plus `kind: 'text'`, `text`, `fontFamily`, `fontSize`; y is SVG baseline.      |
| `DesignNode`     | Rectangle, ellipse or text discriminated union.                                     |
| `DesignDocument` | `width`, `height`, ordered `nodes`; paint order is array order.                     |
| `ExportLimits`   | `maxNodes`, `maxOutputBytes`, `availableFonts`.                                     |
| `Readiness`      | `ready: boolean`, immutable deduplicated `missingFonts` in first-use order.         |
| `RasterFormat`   | `'png'                                                                              | 'jpeg'`.                     |
| `RasterExporter` | `(document, format, signal?) => Promise<{mediaType,data: Uint8Array}>`.             |
| `ExportOptions`  | Limits plus optional `rasterExporter` and `signal`.                                 |
| `DesignOutput`   | SVG `{format:'svg',mediaType:'image/svg+xml',data:string}` or raster `{format:'png' | 'jpeg',mediaType:'image/png' | 'image/jpeg',data:Uint8Array}`. |

- `checkReadiness(document, options?): Readiness`: validates all input, then reports fonts not explicitly declared available.
- `exportSvg(document, options?): string`: validates readiness and emits actual XML/SVG with geometry, namespace, dimensions and viewBox.
- `exportDesign(document, format, options?): Promise<DesignOutput>`: SVG directly; PNG/JPEG only through the injected raster adapter. PDF and unknown formats fail explicitly.

Input is normalized to a detached frozen snapshot before adapter invocation. Output records are frozen; raster bytes are copied (including Buffers), but remain caller-mutable. All nodes are validated even when covered by other nodes.

## Customize

Reduce `maxNodes`/`maxOutputBytes` for untrusted workloads. Populate `availableFonts` only after your environment's font-loading checks have succeeded; this library does not load fonts or prove browser readiness. For raster export provide your own renderer with real encoding:

```ts
import type { RasterExporter } from '@lp-labs/design-export';
// Implement using your application's actual renderer/encoder:
declare const renderer: RasterExporter;
```

Call `exportDesign(document, 'png', { availableFonts, rasterExporter: renderer, signal })`. The adapter receives normalized primitives, not SVG text. Its MIME type must match the requested format and bytes must be nonempty and within the limit. **The adapter is responsible for actual codec correctness**; this package does not synthesize PNG/JPEG/PDF bytes, inspect signatures, decode or embed images, launch a browser or claim renderer fidelity.

## Safety and readiness scope

IDs and text are XML escaped. XML 1.0 illegal controls, isolated surrogates and U+FFFE/U+FFFF are rejected. Fill allows only `#RRGGBB`, `#RRGGBBAA` or `none`, not CSS, URL paints or attribute fragments. Families allow one simple ASCII name starting with a letter (letters/digits/spaces/hyphens), not raw CSS.

No scripts, event attributes, arbitrary markup, images, paths, remote references, CSS, layers, transforms, clipping, text layout, embedded fonts or PDF encoder are supported. SVG relies on the recipient's font rendering; the available-font declaration is an explicit caller readiness assertion, not portable font embedding.

## Errors and cancellation

`DesignExportError(code, message, options?)` preserves adapter causes:

| `code`        | Meaning                                                              |
| ------------- | -------------------------------------------------------------------- |
| `invalid`     | Invalid document/options/geometry/text/fill/font/signal.             |
| `capacity`    | Too many nodes or output UTF-8/raster byte limit exceeded.           |
| `not-ready`   | A text family is not in `availableFonts`.                            |
| `unsupported` | Unsupported node/format, or missing raster adapter.                  |
| `cancelled`   | Abort before export or after adapter settlement; no output returned. |
| `adapter`     | Adapter rejection or malformed/mismatched/empty raster result.       |

Signal and adapter references are captured before awaiting. Abort does not terminate an adapter that ignores its signal: the promise waits for settlement. External renderer effects cannot be undone. There are no retries, deadlines or automatic resource discovery.

## Limits

| Setting          |   Default |       Allowed |
| ---------------- | --------: | ------------: |
| `maxNodes`       |      1000 |     1..10,000 |
| `maxOutputBytes` | 1,048,576 | 1..67,108,864 |

Document dimensions: finite 1..16,384. Positions: ±1,000,000. Shape dimensions/radii: 0..1,000,000. Font size: 1..4096. Opacity: 0..1. Unique non-whitespace IDs: 128 UTF-16 units; text: 16,384 units; families: 128 units; at most 256 available font entries. Empty documents are valid. SVG byte limits count UTF-8 including escaping and closing markup.

## Development

```sh
npm ci --offline
npm run build
npm run typecheck
npm test
npm run format:check
```

Dev-only TypeScript `^5.9.3`, Prettier `^3.6.2`; `format` writes formatting, `prepack` builds. Dual `dist/esm`/`dist/cjs` output has declarations. Tests check exact SVG, actual byte outputs, readiness, cancellation races and standalone CJS; bare `.mts`/`.cts` consumers validate declarations.

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
