/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Escapes a value for safe insertion into webview HTML. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Shared SIID Forge webview styles (brand purple/orange). */
export const FORGE_STYLES = `
  body { font-family: 'Segoe UI', sans-serif; margin: 0; padding: 16px; background: #1e1e1e; color: #eee; }
  h1 { color: #a874e3; font-size: 1.15em; font-weight: 600; margin: 0 0 12px; }
  .muted { color: #999; font-size: 12px; margin-bottom: 12px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { border: 1px solid #333; padding: 6px 10px; text-align: left; vertical-align: top; }
  th { background: #2a2a2a; color: #a874e3; position: sticky; top: 0; }
  tr:nth-child(even) td { background: #232323; }
  button { padding: 8px 16px; border: none; border-radius: 6px; font-size: 13px; cursor: pointer; font-weight: 500; color: #fff; background: #432264; }
  button:hover { background: #5c3791; }
  button.secondary { background: #3c3c3c; }
  button.secondary:hover { background: #4c4c4c; }
  .accent { background: #ff7800; }
  .accent:hover { background: #ff9540; }
`;
