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

/**
 * Shared SIID Forge webview styles + component kit. Driven by VS Code theme
 * variables (`--vscode-*`) so panels match the active SIID/AIPexiumNight theme
 * exactly (and any theme the user picks); the SIID brand hexes are fallbacks.
 * Every Forge webview composes these primitives — buttons, headers, tables,
 * cards, badges, inputs, form rows — instead of re-styling its own.
 */
export const FORGE_STYLES = `
  :root {
    /* SIID brand accents (fallbacks for the theme vars). */
    --forge-purple: var(--vscode-panelTitle-activeForeground, #663399);
    --forge-purple-bright: #a852ff;
    --forge-orange: #ff7800;
    --forge-accent-bg: var(--vscode-button-background, #4e227b);
    --forge-accent-fg: var(--vscode-button-foreground, #ff7800);
    --forge-accent-hover: var(--vscode-button-hoverBackground, #402060);
    --forge-sel: var(--vscode-list-activeSelectionBackground, #432264);
    --forge-bg: var(--vscode-editor-background, #1e1e1e);
    --forge-fg: var(--vscode-foreground, #cccccc);
    --forge-border: var(--vscode-panel-border, #80808059);
    --forge-input-bg: var(--vscode-input-background, #3c3c3c);
    --forge-input-fg: var(--vscode-input-foreground, #cccccc);
    --forge-focus: var(--vscode-focusBorder, #663399);
    --forge-muted: var(--vscode-descriptionForeground, #9d9d9d);
    --forge-link: var(--vscode-textLink-foreground, #af82db);
    --forge-ok: #73c991;
    --forge-err: var(--vscode-errorForeground, #f48771);
    --forge-warn: #cca700;
    --forge-card: var(--vscode-editorWidget-background, #252526);
    --forge-th: var(--vscode-keybindingTable-headerBackground, #2a2a2a);
  }

  body {
    font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
    font-size: var(--vscode-font-size, 13px);
    margin: 0; padding: 16px; background: var(--forge-bg); color: var(--forge-fg);
  }
  h1 { color: var(--forge-purple); font-size: 1.2em; font-weight: 600; margin: 0 0 12px; }
  h2 { color: var(--forge-purple); font-size: 1em; font-weight: 600; margin: 16px 0 8px; }
  a, .link { color: var(--forge-link); cursor: pointer; text-decoration: none; }
  a:hover, .link:hover { text-decoration: underline; }
  code { font-family: var(--vscode-editor-font-family, monospace); color: var(--forge-purple-bright); }
  .muted { color: var(--forge-muted); font-size: 12px; }
  .ok { color: var(--forge-ok); }
  .err { color: var(--forge-err); }
  .warn { color: var(--forge-warn); }

  /* Tables */
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { border: 1px solid var(--forge-border); padding: 6px 10px; text-align: left; vertical-align: top; }
  th { background: var(--forge-th); color: var(--forge-purple); position: sticky; top: 0; }
  tr:hover td { background: var(--forge-sel); }

  /* Buttons — primary (purple bg / orange text, the SIID button look) + secondary + accent (solid orange) */
  button {
    padding: 7px 14px; border: 1px solid transparent; border-radius: 4px; font-size: 13px;
    cursor: pointer; font-weight: 500; color: var(--forge-accent-fg); background: var(--forge-accent-bg);
    font-family: inherit;
  }
  button:hover { background: var(--forge-accent-hover); }
  button:focus-visible { outline: 1px solid var(--forge-focus); outline-offset: 1px; }
  button:disabled { opacity: .5; cursor: default; }
  button.secondary {
    color: var(--vscode-button-secondaryForeground, #ff7800);
    background: var(--vscode-button-secondaryBackground, #3a3d41);
  }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground, #45494e); }
  button.accent { color: #fff; background: var(--forge-orange); }
  button.accent:hover { background: #ff9540; }

  /* Inputs / textareas / selects */
  input[type=text], input:not([type]), textarea, select {
    background: var(--forge-input-bg); color: var(--forge-input-fg);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px;
    padding: 6px 9px; font-size: 13px; font-family: inherit; box-sizing: border-box;
  }
  input:focus, textarea:focus, select:focus { outline: none; border-color: var(--forge-focus); }
  input::placeholder, textarea::placeholder { color: var(--vscode-input-placeholderForeground, #a6a6a6); }
  input[type=checkbox] { accent-color: var(--forge-purple); }
  label { font-size: 11px; color: var(--forge-muted); text-transform: uppercase; letter-spacing: .03em; }

  /* Layout primitives */
  .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .field { display: flex; flex-direction: column; gap: 4px; }
  .grow { flex: 1; }
  .toolbar { display: flex; gap: 8px; align-items: center; margin: 10px 0; flex-wrap: wrap; }

  /* Card (grouped section) */
  .card { border: 1px solid var(--forge-border); border-radius: 8px; padding: 12px 14px; margin: 8px 0; background: var(--forge-card); }
  .card h3 { margin: 0 0 6px; font-size: 13px; color: var(--forge-purple); display: flex; gap: 8px; align-items: center; }

  /* Badge / pill / chip */
  .badge, .pill { display: inline-block; font-size: 11px; padding: 1px 9px; border-radius: 10px;
    background: var(--vscode-badge-background, #4d4d4d); color: var(--vscode-badge-foreground, #fff); border: 1px solid transparent; }
  .pill { margin: 2px 4px 2px 0; }
  .badge.pass, .pill.ok { background: #173d27; color: var(--forge-ok); }
  .badge.fail, .pill.err { background: #3d1717; color: var(--forge-err); }
  .kind { color: var(--forge-orange); font-size: 11px; text-transform: uppercase; }

  /* Section spacing */
  .section { margin: 18px 0; }
`;
