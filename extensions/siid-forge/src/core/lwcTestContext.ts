/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'fs';
import * as path from 'path';
import { analyzeComponent, LwcComponentFacts } from './lwcTestScaffold';
import { analyzeMocks } from './lwcMockScaffold';

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

  const js = read(jsFilePath);
  const apexImports = parseApexImports(js);
  const mocks = analyzeMocks(js);
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
    `1. CONDITIONAL/ASYNC RENDERING IS THE #1 CAUSE OF FAILURE. Most of the template is behind \`lwc:if\` / a loaded flag (e.g. isLoaded) that is only true AFTER data loads. At appendChild time those elements DO NOT EXIST and querySelector returns null. Before asserting any element gated by a condition you MUST drive the component to that state: set the @api props, make the mocked Apex/wire RESOLVE (mockResolvedValue / adapter.emit(...)), then FLUSH async with \`await flushPromises()\` where \`const flushPromises = () => new Promise((r) => setTimeout(r, 0));\` (a single \`await Promise.resolve()\` is NOT enough for a load chain). Read the .js to find the exact condition each element depends on, and only assert it after reaching that state. If an element can never render in a given test state, don't query it.`,
    `2. Interact ONLY through the public surface and the DOM. NEVER call internal/handler methods on the element (element.handleSave(), element.handleBrowseLayouts(), element._anything) — they are not @api and throw "is not a function". To trigger a handler, dispatch the REAL DOM event on the child from the template (e.g. element.shadowRoot.querySelector('lightning-button').dispatchEvent(new CustomEvent('click'))).`,
    `3. NEVER set or read non-@api fields on the element (element.fieldConfigs, element.layoutName, element._isDirty, etc.). Only the @api props listed below. Drive internal state ONLY by resolving mocks + DOM events, never by assignment.`,
    `4. Only query selectors that actually appear in the .html template, AND only after that branch is rendered. Read the template — do not guess tag names, classes, or data-* attributes.`,
    `5. For mocked Apex calls, assert call arguments ONLY if you copied the exact param object from the component's JS. If unsure, assert \`toHaveBeenCalled()\`, not \`toHaveBeenCalledWith(...)\`.`,
    `6. To test a dispatched CustomEvent (${facts.events.length ? facts.events.map((e) => '`' + e + '`').join(', ') : 'if any'}): add the listener, then REACH THE STATE where the triggering child is rendered (resolve load mocks + await flushPromises()), find that child in the shadowRoot, dispatch the REAL child DOM event it listens to (read the .html onX handler to know which: click/change/etc.), await flushPromises() again, then assert it fired. Assert \`event.detail\` ONLY as constructed in the JS source; otherwise just assert it fired. Never dispatch the component's own outgoing event yourself, and never call the handler directly.`,
    `7. Mock every imported Apex method and every imported c/* module the component uses, before importing the component.`,
    `8. PROMISE-RETURNING MOCKS ARE MANDATORY. The #1 crash is "Cannot read properties of undefined (reading 'then')": any function the component calls with .then()/await (every imported Apex method, and empApi subscribe/unsubscribe/isEmpEnabled) MUST be a jest.fn that RETURNS A PROMISE — never a bare jest.fn() (which returns undefined). Set default resolved values in beforeEach (e.g. getX.mockResolvedValue([]); subscribe.mockResolvedValue({ id: 'sub' })). Read the .js to see which imports are awaited/chained and give them realistic resolved data so the load completes and the UI renders.`,
    `9. KEEP the mock setup block already in the scaffold (it returns Promises correctly). Extend it — do NOT replace those jest.mock factories with bare jest.fn()s.`,
    ``,
    `Public surface (the ONLY things you may drive/assert; verify against source):`,
    `- @api: ${facts.apiProps.length ? facts.apiProps.map((p) => '`' + p + '`').join(', ') : '(none)'}`,
    `- events dispatched: ${facts.events.length ? facts.events.map((e) => '`' + e + '`').join(', ') : '(none)'}`,
    `- @wire: ${facts.wires.length ? facts.wires.map((w) => '`' + w + '`').join(', ') : '(none)'}`,
    `- imported Apex: ${apexImports.length ? apexImports.map((a) => '`' + a + '`').join(', ') : '(none)'}`,
    ``,
    ...(mocks.needs.length
      ? [
        `Salesforce modules to mock (the scaffold already includes the setup — use it):`,
        ...mocks.guidanceLines.map((g) => `- ${g}`),
        ``
      ]
      : []),
    `COVER (write REAL interaction tests — not just "renders without throwing"). Read the .html for every interactive control and its handler, and the .js for what each handler does, then test BEHAVIOUR:`,
    `- Render: the component renders; key sections appear AFTER load (resolve mocks + flushPromises).`,
    `- Button clicks: for each button (lightning-button / button with onclick), dispatch a click on the rendered element and assert the RESULT — the Apex/method it calls (assert the mock was called), the toast shown, the event dispatched, or the DOM change. (e.g. Save → assert the save Apex mock called; Cancel → assert 'cancel' event.)`,
    `- Input/typing & change: for inputs/combobox/checkbox (lightning-input, lightning-combobox, onchange handlers), set the value and dispatch a 'change'/'input' CustomEvent({ detail: { value } }) on the rendered element, flush, then assert the resulting state via the DOM or a downstream mock call.`,
    `- Async paths: success AND failure — make a mock reject (mockRejectedValue) and assert the error handling (e.g. error toast via ShowToastEvent), and the happy path with data.`,
    `- Conditional UI: toggle the @api/inputs that drive lwc:if and assert the branch appears/disappears.`,
    `Do NOT settle for a single render test if the component has buttons, inputs, or events — exercise them. Only assert things the source actually supports (per the hard rules).`,
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
