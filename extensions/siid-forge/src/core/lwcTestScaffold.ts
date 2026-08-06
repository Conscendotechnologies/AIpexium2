/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'fs';
import * as path from 'path';
import { analyzeMocks, MockScaffold } from './lwcMockScaffold';

/**
 * Headless LWC Jest test scaffolder (agent-consumable, per §14). Given a
 * component's JS source it derives the public surface — `@api` props, `@wire`
 * adapters, dispatched events — and emits a ready-to-run Jest test skeleton in
 * the canonical `sfdx-lwc-jest` style. The UI command and the AI agent both
 * call this; the AI can then fill in meaningful assertions (feature C).
 */

export interface LwcComponentFacts {
  /** camelCase component folder/module name, e.g. `fieldConfigRow`. */
  name: string;
  /** The default-exported class name, e.g. `FieldConfigRow`. */
  className: string;
  /** kebab-case custom element tag, e.g. `c-field-config-row`. */
  tag: string;
  /** Public `@api` property / accessor names. */
  apiProps: string[];
  /** `@wire` adapter identifiers used (best-effort). */
  wires: string[];
  /** CustomEvent names this component dispatches. */
  events: string[];
}

export interface ScaffoldResult {
  /** Absolute path the test file should be written to. */
  testPath: string;
  /** The generated test source. */
  content: string;
  facts: LwcComponentFacts;
  /** True if a test file already exists at testPath. */
  exists: boolean;
}

/** Reads + analyses a component's JS into its public-surface facts. */
export function analyzeComponent(jsFilePath: string): LwcComponentFacts {
  const name = path.basename(jsFilePath, '.js');
  let src = '';
  try {
    src = fs.readFileSync(jsFilePath, 'utf-8');
  } catch { /* leave empty → minimal scaffold */ }

  const className = matchClassName(src) ?? capitalize(name);
  return {
    name,
    className,
    tag: `c-${kebab(name)}`,
    apiProps: parseApiProps(src),
    wires: parseWires(src),
    events: parseEvents(src)
  };
}

/**
 * Builds the scaffold for the component whose JS is at `jsFilePath`. Does NOT
 * write anything — the caller decides (and can check `exists`).
 */
export function scaffoldLwcTest(jsFilePath: string): ScaffoldResult {
  const facts = analyzeComponent(jsFilePath);
  const dir = path.dirname(jsFilePath);
  const testPath = path.join(dir, '__tests__', `${facts.name}.test.js`);
  let src = '';
  try {
    src = fs.readFileSync(jsFilePath, 'utf-8');
  } catch { /* minimal scaffold */ }
  return {
    testPath,
    content: renderTest(facts, analyzeMocks(src)),
    facts,
    exists: fs.existsSync(testPath)
  };
}

/* ----------------------------- parsing ---------------------------------- */

function matchClassName(src: string): string | undefined {
  return src.match(/export\s+default\s+class\s+(\w+)/)?.[1];
}

/** Collects `@api` property and accessor names (de-duplicated, in order). */
function parseApiProps(src: string): string[] {
  const out: string[] = [];
  const re = /@api\s+(?:get\s+|set\s+)?(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (!out.includes(m[1])) {
      out.push(m[1]);
    }
  }
  return out;
}

/** Collects `@wire(adapter, …)` adapter identifiers (best-effort). */
function parseWires(src: string): string[] {
  const out: string[] = [];
  const re = /@wire\(\s*([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (!out.includes(m[1])) {
      out.push(m[1]);
    }
  }
  return out;
}

/** Collects CustomEvent names dispatched by the component. */
function parseEvents(src: string): string[] {
  const out: string[] = [];
  const re = /new\s+CustomEvent\(\s*['"]([\w-]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (!out.includes(m[1])) {
      out.push(m[1]);
    }
  }
  return out;
}

/* ----------------------------- rendering -------------------------------- */

function renderTest(f: LwcComponentFacts, mocks: MockScaffold): string {
  const apiSetup = f.apiProps.length
    ? f.apiProps.map((p) => `        // element.${p} = ...;`).join('\n')
    : '        // (no public @api properties detected)';

  // Mock setup for the Salesforce modules this component uses (toasts, wire,
  // empApi, navigation, LMS). These must sit above the component import.
  const mockBlock = mocks.setupBlock ? `\n${mocks.setupBlock}\n` : '';

  const eventTest = f.events.length
    ? renderEventTest(f, f.events[0])
    : '';

  return `import { createElement } from '@lwc/engine-dom';
import ${f.className} from 'c/${f.name}';
${mockBlock}
// Flush the async/render chain. Use this (not a single Promise.resolve) before
// asserting DOM that appears only AFTER data loads / lwc:if conditions resolve.
const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('${f.tag}', () => {
    afterEach(() => {
        // The jsdom instance is shared across tests in a file — reset the DOM.
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        jest.clearAllMocks();
    });

    function createComponent() {
        const element = createElement('${f.tag}', { is: ${f.className} });
${apiSetup}
        document.body.appendChild(element);
        return element;
    }

    it('renders without throwing', () => {
        const element = createComponent();
        expect(element).not.toBeNull();
        expect(document.body.querySelector('${f.tag}')).not.toBeNull();
    });

    // ── Interaction tests — replace the examples below with REAL ones from the
    // template (read the .html for controls + handlers, the .js for behaviour):
    //
    // it('calls the action on button click', async () => {
    //     const element = createComponent();
    //     await flushPromises();                       // let load-gated UI render
    //     const btn = element.shadowRoot.querySelector('lightning-button[data-id="save"]');
    //     btn.dispatchEvent(new CustomEvent('click'));
    //     await flushPromises();
    //     expect(/* the Apex/method mock */).toHaveBeenCalled();
    // });
    //
    // it('handles input change', async () => {
    //     const element = createComponent();
    //     await flushPromises();
    //     const input = element.shadowRoot.querySelector('lightning-input');
    //     input.dispatchEvent(new CustomEvent('change', { detail: { value: 'x' } }));
    //     await flushPromises();
    //     // assert resulting DOM / downstream mock call
    // });
${eventTest}});
`;
}

function renderEventTest(f: LwcComponentFacts, eventName: string): string {
  return `
    it('dispatches the "${eventName}" event', async () => {
        const element = createComponent();
        const handler = jest.fn();
        element.addEventListener('${eventName}', handler);

        // 1. Reach the state where the triggering child is rendered (resolve any
        //    load mocks first), then flush so lwc:if branches render:
        await flushPromises();

        // 2. Trigger the real interaction that fires "${eventName}" — dispatch a
        //    DOM event on the child from the template (find the actual selector
        //    + child event name in the component .js/.html):
        // const child = element.shadowRoot.querySelector('lightning-button[data-id="save"]');
        // child.dispatchEvent(new CustomEvent('click'));

        // 3. Flush again, then assert it fired (and the detail shape from source):
        // await flushPromises();
        // expect(handler).toHaveBeenCalled();
        // expect(handler.mock.calls[0][0].detail).toEqual(/* shape from JS */);
    });
`;
}

/* ------------------------------ helpers --------------------------------- */

function kebab(camel: string): string {
  return camel.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
