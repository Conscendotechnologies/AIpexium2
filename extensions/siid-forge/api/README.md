# @conscendotech/siid-forge-api

Public TypeScript types for the **SIID Forge** extension SDK
(`ConscendoTechInc.siid-forge`).

This package is **types only** — it ships no runtime code. The live API is a
stateful object you obtain from the installed extension at runtime; this package
just gives you the compile-time shape of it.

## Install

```jsonc
// package.json
"dependencies": {
  "@conscendotech/siid-forge-api": "^2.14.0"
}
```

The package version **tracks `SiidForgeApi.version`**, so `^2.14.0` gives you the
type surface a Forge that reports `2.14.x` at runtime actually exposes. A build-time
guard in the extension fails if the two ever drift.

## Use

```ts
import * as vscode from 'vscode';
import type { SiidForgeApi } from '@conscendotech/siid-forge-api';

const ext = vscode.extensions.getExtension('ConscendoTechInc.siid-forge');
const forge = (await ext?.activate()) as SiidForgeApi | undefined;

if (forge && forge.version >= '2.12.0') {
  const analysis = forge.logs.analyze(rawLog);
}
```

Add `"extensionDependencies": ["ConscendoTechInc.siid-forge"]` to your extension's
`package.json` if it might activate before Forge.

See the extension's `CONSUMING.md` for the full API surface and command list.

**Maintaining this package** (changing the API, bumping the version): see
[`MAINTAINING.md`](./MAINTAINING.md).
