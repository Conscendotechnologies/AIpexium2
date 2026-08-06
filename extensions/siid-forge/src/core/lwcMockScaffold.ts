/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Detects the Salesforce modules an LWC imports that need an EXPLICIT Jest mock
 * (or a wire test adapter) to be testable. `sfdx-lwc-jest` auto-stubs every
 * `lightning/*` module so components LOAD, but those stubs are inert — you can't
 * assert a toast fired, emit @wire data, or capture navigation without setting
 * up real mocks. This headless service (agent-consumable, §14) produces both the
 * ready-to-use mock setup blocks (for the deterministic scaffold) and concise
 * guidance (for the AI prompt).
 */

export interface MockNeed {
  /** Stable id, e.g. 'toast', 'wire-apex', 'navigation'. */
  id: string;
  /** Human label for prompts. */
  label: string;
  /** A jest mock / setup block to inject near the top of the test. */
  setup: string;
  /** One-line guidance for the AI prompt on how to use it. */
  guidance: string;
}

export interface MockScaffold {
  needs: MockNeed[];
  /** All setup blocks joined (deterministic scaffold injection). */
  setupBlock: string;
  /** All guidance lines (AI prompt injection). */
  guidanceLines: string[];
}

/** Analyses component JS and returns the mocks its tests will need. */
export function analyzeMocks(js: string): MockScaffold {
  const needs: MockNeed[] = [];

  // --- Toasts ---
  if (/platformShowToastEvent|ShowToastEvent/.test(js)) {
    needs.push({
      id: 'toast',
      label: 'ShowToastEvent (toasts)',
      setup:
        `// ShowToastEvent must return a REAL event so this.dispatchEvent() works,\n` +
        `// AND be a jest.fn so tests can assert the toast payload.\n` +
        `jest.mock(\n` +
        `    'lightning/platformShowToastEvent',\n` +
        `    () => ({\n` +
        `        ShowToastEvent: jest.fn().mockImplementation((detail) => new CustomEvent('lightning__showtoast', { detail }))\n` +
        `    }),\n` +
        `    { virtual: true }\n` +
        `);\n` +
        `import { ShowToastEvent } from 'lightning/platformShowToastEvent';`,
      guidance: `Toasts: assert via the jest.fn — expect(ShowToastEvent).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' })). The mock returns a real CustomEvent so dispatchEvent works.`
    });
  }

  // --- emp API (platform events / streaming) ---
  if (/lightning\/empApi/.test(js)) {
    needs.push({
      id: 'empApi',
      label: 'empApi (streaming)',
      setup:
        `jest.mock(\n` +
        `    'lightning/empApi',\n` +
        `    () => ({\n` +
        `        subscribe: jest.fn(() => Promise.resolve({ id: 'sub' })),\n` +
        `        unsubscribe: jest.fn(() => Promise.resolve()),\n` +
        `        onError: jest.fn(),\n` +
        `        isEmpEnabled: jest.fn(() => Promise.resolve(true))\n` +
        `    }),\n` +
        `    { virtual: true }\n` +
        `);`,
      guidance: `empApi: subscribe/unsubscribe/isEmpEnabled are jest.fn — to simulate a platform-event message, capture subscribe's callback (subscribe.mock.calls[0][1]) and invoke it with a message payload.`
    });
  }

  // --- Navigation ---
  if (/NavigationMixin|lightning\/navigation/.test(js)) {
    needs.push({
      id: 'navigation',
      label: 'NavigationMixin',
      setup:
        `// NavigationMixin.Navigate is provided by the sfdx-lwc-jest stub; spy to assert.\n` +
        `import { CurrentPageReference } from 'lightning/navigation';`,
      guidance: `Navigation: spy on the element's navigation — assert NavigationMixin.Navigate was called with the expected pageReference (use the test pattern from sfdx-lwc-jest docs).`
    });
  }

  // --- LDS getRecord / object info / picklists (wire) ---
  const ldsAdapters = matchAll(js, /\b(getRecord|getRecordUi|getObjectInfo|getPicklistValues|getRelatedListRecords)\b/g);
  if (ldsAdapters.length) {
    needs.push({
      id: 'wire-lds',
      label: `LDS wire (${ldsAdapters.join(', ')})`,
      setup:
        `import { registerLdsTestWireAdapter } from '@salesforce/sfdx-lwc-jest';\n` +
        ldsAdapters.map((a) => `import { ${a} } from 'lightning/uiRecordApi';`).join('\n') + `\n` +
        ldsAdapters.map((a) => `const ${a}Adapter = registerLdsTestWireAdapter(${a});`).join('\n'),
      guidance: `LDS @wire (${ldsAdapters.join(', ')}): emit data with <adapter>Adapter.emit(require('./data/<fixture>.json')) after appendChild, then await a microtask and assert the DOM. Create the JSON fixture under __tests__/data/.`
    });
  }

  // --- Apex @wire adapters (imported from @salesforce/apex used inside @wire) ---
  const apexWire = matchAll(js, /@wire\(\s*([A-Za-z_$][\w$]*)/g)
    .filter((name) => new RegExp(`import\\s+${name}\\s+from\\s+['"]@salesforce/apex/`).test(js));
  if (apexWire.length) {
    needs.push({
      id: 'wire-apex',
      label: `Apex wire (${apexWire.join(', ')})`,
      setup:
        `import { registerApexTestWireAdapter } from '@salesforce/sfdx-lwc-jest';\n` +
        apexWire.map((a) => `const ${a}Adapter = registerApexTestWireAdapter(${a});`).join('\n'),
      guidance: `Apex @wire (${apexWire.join(', ')}): emit with <adapter>Adapter.emit(data) (and .error() for the error path), await a microtask, assert the DOM.`
    });
  }

  // --- Message service (LMS pub/sub) ---
  if (/lightning\/messageService|publish\(|subscribe\(|MessageContext/.test(js) && !/lightning\/empApi/.test(js)) {
    needs.push({
      id: 'lms',
      label: 'Lightning Message Service',
      setup:
        `jest.mock('lightning/messageService', () => ({\n` +
        `    publish: jest.fn(),\n` +
        `    subscribe: jest.fn(),\n` +
        `    unsubscribe: jest.fn(),\n` +
        `    MessageContext: jest.fn(),\n` +
        `    APPLICATION_SCOPE: Symbol('APPLICATION_SCOPE')\n` +
        `}), { virtual: true });`,
      guidance: `LMS: assert publish was called with the channel + payload; to simulate an incoming message, invoke the handler passed to subscribe.`
    });
  }

  return {
    needs,
    setupBlock: needs.map((n) => n.setup).join('\n\n'),
    guidanceLines: needs.map((n) => n.guidance)
  };
}

function matchAll(s: string, re: RegExp): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (!out.includes(m[1])) {
      out.push(m[1]);
    }
  }
  return out;
}
