/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'fs';
import * as path from 'path';
import { analyzeComponent, LwcComponentFacts } from './lwcTestScaffold';

/**
 * Builds the context + prompt that the SIID-Code AI agent uses to write real
 * LWC Jest test bodies (layer C of LWC test automation). Headless +
 * agent-consumable per §14: it gathers the deterministic facts (component
 * sources, public surface, imported Apex, existing test style) and assembles a
 * precise instruction. The actual test writing is delegated to the agent.
 */

export interface LwcTestPrompt {
  facts: LwcComponentFacts;
  /** Absolute path the test should live at. */
  testPath: string;
  /** The assembled prompt text handed to the agent. */
  text: string;
}

/**
 * Builds the agent prompt for the component whose JS is at `jsFilePath`. The
 * agent has file-read tools, so we point it at the source files by PATH (it
 * reads them itself, always fresh) rather than inlining content. We still pass
 * the parsed facts as hints so it knows the public surface up front.
 */
export function buildLwcTestPrompt(jsFilePath: string, _scaffold: string): LwcTestPrompt {
  const facts = analyzeComponent(jsFilePath);
  const dir = path.dirname(jsFilePath);
  const testPath = path.join(dir, '__tests__', `${facts.name}.test.js`);

  const apexImports = parseApexImports(read(jsFilePath));
  const relJs = toRel(jsFilePath);
  const relHtml = toRel(path.join(dir, `${facts.name}.html`));
  const relMeta = toRel(path.join(dir, `${facts.name}.js-meta.xml`));
  const relTest = toRel(testPath);

  const text = [
    `TASK TYPE: write a Jest unit test for an EXISTING Lightning Web Component. This is NOT component creation.`,
    `- Do NOT create or modify the component (\`.js\`/\`.html\`/\`.css\`/\`.js-meta.xml\`) — it already exists.`,
    `- Do NOT load the "create-lwc" guide, do NOT deploy anything (no sf_deploy_metadata / sf project deploy), and do NOT ask "reuse existing vs create new". The only file you write is the \`.test.js\` below.`,
    ``,
    `Write meaningful, PASSING Jest unit tests for \`${facts.name}\` (\`<${facts.tag}>\`).`,
    ``,
    `STEP 1 — Read the actual source (do not assume contents):`,
    `- \`${relJs}\` — component logic`,
    `- \`${relHtml}\` — template (the only DOM you may query/assert)`,
    `- \`${relMeta}\` — metadata`,
    `- \`${relTest}\` — existing scaffold to replace + the project's test style`,
    `Also read the Apex controller source under \`force-app/main/default/classes/\` for any imported method whose EXACT parameter names you assert on.`,
    ``,
    `STEP 2 — Write the test to \`${relTest}\`. Conventions: import from '@lwc/engine-dom', createElement, appendChild, afterEach DOM cleanup + jest.clearAllMocks().`,
    ``,
    `HARD RULES (these are why tests usually fail — obey them strictly):`,
    `1. Interact ONLY through the public surface and the DOM. NEVER call internal/handler methods on the element (e.g. element.handleSuccess(), element.handleCancel(), element._private). They are not exposed and will throw "is not a function". To trigger a handler, dispatch the real DOM event on the child element from the template (e.g. element.shadowRoot.querySelector('lightning-record-edit-form').dispatchEvent(new CustomEvent('success', { detail: {...} }))).`,
    `2. Only set/read the @api properties listed below. Do NOT set or assert non-@api fields on the element.`,
    `3. Only query selectors that actually appear in the .html template. Read the template — do not guess tag names, classes, or data-* attributes.`,
    `4. For mocked Apex calls, assert call arguments ONLY if you copied the exact param object from the component's JS (e.g. the literal \`{ objectApiName }\` it passes). If unsure of the exact shape, assert \`toHaveBeenCalled()\` instead of \`toHaveBeenCalledWith(...)\`.`,
    `5. For dispatched CustomEvents, assert the \`event.detail\` shape ONLY as constructed in the JS source; otherwise just assert the event fired.`,
    `6. Mock every imported Apex method and every imported c/* module the component uses, before importing the component.`,
    ``,
    `Public surface (the ONLY things you may drive/assert; verify against source):`,
    `- @api: ${facts.apiProps.length ? facts.apiProps.map((p) => '`' + p + '`').join(', ') : '(none)'}`,
    `- events dispatched: ${facts.events.length ? facts.events.map((e) => '`' + e + '`').join(', ') : '(none)'}`,
    `- @wire: ${facts.wires.length ? facts.wires.map((w) => '`' + w + '`').join(', ') : '(none)'}`,
    `- imported Apex: ${apexImports.length ? apexImports.map((a) => '`' + a + '`').join(', ') : '(none)'}`,
    ``,
    `Cover: renders without throwing; @api-driven rendering (set @api props, await a microtask, assert DOM that exists in the template); event dispatch verified via real child DOM events; Apex/wire mocking.`,
    ``,
    `STEP 3 — RUN the tests and make them PASS before finishing: \`npx sfdx-lwc-jest -- --testPathPattern ${facts.name}\`. If any test fails, fix it (prefer relaxing an over-specific assertion per the rules above over asserting something the source doesn't support). Do not finish with failing tests.`
  ].join('\n');

  return { facts, testPath, text };
}

/** Collects `import X from '@salesforce/apex/Class.method'` references. */
function parseApexImports(js: string): string[] {
  const out: string[] = [];
  const re = /@salesforce\/apex\/([\w.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(js)) !== null) {
    if (!out.includes(m[1])) {
      out.push(m[1]);
    }
  }
  return out;
}

function read(p: string): string {
  try {
    return fs.readFileSync(p, 'utf-8');
  } catch {
    return '';
  }
}

function toRel(p: string): string {
  const norm = p.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/force-app/');
  return i >= 0 ? norm.slice(i + 1) : norm.split('/').pop() ?? norm;
}
