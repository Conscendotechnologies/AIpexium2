# @conscendotech/siid-compression-api

Public TypeScript types for the **SIID Compression** extension (`ConscendoTechInc.siid-compression`).
**Types only** — nothing here runs. The live API object is bound at runtime via the installed
extension's `activate()`.

## What the extension does

Runs a local Node.js OpenRouter proxy that losslessly compresses LLM conversation context
(structured tool output, repeated log lines, re-pasted file bodies) before it reaches OpenRouter.
Consumers route through it by pointing their OpenAI/OpenRouter client's base URL at the proxy.

## Install

**In the SIID monorepo** — resolved via the consumer's `tsconfig.json` `paths` mapping to
`../siid-compression/api/index.d.ts` (no install).

**In another repo of ours (e.g. SIID-Code)** — as a Git dependency on the standalone mirror repo:

```bash
pnpm add github:Conscendotechnologies/siid-compression-api
# pin a tag: pnpm add github:Conscendotechnologies/siid-compression-api#v0.1.0
```

The import specifier `@conscendotech/siid-compression-api` is identical in both cases.

## Use (route an OpenRouter client through the compression proxy)

```ts
import * as vscode from 'vscode';
import type { ICompressionApi } from '@conscendotech/siid-compression-api';

const COMPRESSION_EXT_ID = 'ConscendoTechInc.siid-compression';

function resolveCompressionBaseUrl(): string | undefined {
  try {
    const ext = vscode.extensions.getExtension(COMPRESSION_EXT_ID);
    const api = ext?.isActive ? (ext.exports as ICompressionApi | undefined) : undefined;
    const base = api?.getProxyBaseUrl();   // '' when the proxy is not healthy
    return base || undefined;
  } catch {
    return undefined;                       // extension absent → caller uses OpenRouter directly
  }
}
```

If the extension is absent or its proxy isn't healthy, `getProxyBaseUrl()` returns `''` and the
consumer talks to OpenRouter directly. **Compression is optional infra — never a hard dependency.**

See `MAINTAINING.md` for how the types stay in sync with the extension's runtime API.
