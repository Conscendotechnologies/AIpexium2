/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { SfExecutor } from './sfExecutor';

/**
 * Anonymous-Apex introspection: generates a small describe script, runs it on the
 * org via `sf apex run`, and parses a single JSON line it emits. This gives LIVE
 * org facts (field/object describe, FLS, picklist, data counts) that the
 * Tooling API / metadata scans don't surface cleanly.
 *
 * Headless service — UI (impact report) and the AI agent both call it. The probe
 * framework is intentionally extensible: add a script builder + a typed result.
 */

/** Live facts about a field, from `Schema.DescribeFieldResult`. */
export interface FieldFacts {
  exists: boolean;
  object: string;
  field: string;
  label?: string;
  type?: string;
  custom?: boolean;
  calculated?: boolean;       // formula / rollup
  calculatedFormula?: string | null;
  referenceTo?: string[];
  picklistValues?: string[];
  required?: boolean;         // not nillable & no default
  unique?: boolean;
  externalId?: boolean;
  /** Populated record count, when requested (opt-in; may be slow). */
  populated?: number;
  totalRecords?: number;
  error?: string;
}

/** Builds the anon-Apex that describes a field and emits one JSON debug line. */
function fieldProbeScript(object: string, field: string, withCounts: boolean): string {
  // We emit a sentinel-prefixed JSON line so the log parser can find it exactly.
  const counts = withCounts
    ? `
    try {
      Integer total = Database.countQuery('SELECT COUNT() FROM ${object}');
      Integer filled = Database.countQuery('SELECT COUNT() FROM ${object} WHERE ${field} != null');
      out.put('totalRecords', total);
      out.put('populated', filled);
    } catch (Exception e) { out.put('countError', e.getMessage()); }`
    : '';

  return `
Map<String, Object> out = new Map<String, Object>();
try {
  SObjectType t = Schema.getGlobalDescribe().get('${object}');
  if (t == null) { out.put('exists', false); out.put('error', 'Object not found'); }
  else {
    Map<String, SObjectField> fields = t.getDescribe().fields.getMap();
    SObjectField f = fields.get('${field}');
    if (f == null) { out.put('exists', false); out.put('error', 'Field not found'); }
    else {
      DescribeFieldResult d = f.getDescribe();
      out.put('exists', true);
      out.put('label', d.getLabel());
      out.put('type', String.valueOf(d.getType()));
      out.put('custom', d.isCustom());
      out.put('calculated', d.isCalculated());
      out.put('calculatedFormula', d.getCalculatedFormula());
      out.put('required', !d.isNillable() && !d.isDefaultedOnCreate());
      out.put('unique', d.isUnique());
      out.put('externalId', d.isExternalId());
      List<String> refs = new List<String>();
      for (SObjectType r : d.getReferenceTo()) { refs.add(String.valueOf(r)); }
      out.put('referenceTo', refs);
      List<String> picks = new List<String>();
      for (Schema.PicklistEntry pe : d.getPicklistValues()) { picks.add(pe.getValue()); }
      out.put('picklistValues', picks);${counts}
    }
  }
} catch (Exception e) { out.put('exists', false); out.put('error', e.getMessage()); }
System.debug('SIID_PROBE::' + JSON.serialize(out));
`.trim();
}

/** Runs a field describe probe and returns parsed facts. */
export async function probeField(
  sf: SfExecutor,
  object: string,
  field: string,
  cwd: string,
  opts?: { withCounts?: boolean; token?: vscode.CancellationToken }
): Promise<FieldFacts> {
  const base: FieldFacts = { exists: false, object, field };
  const raw = await runProbe(sf, fieldProbeScript(object, field, !!opts?.withCounts), cwd, opts?.token);
  if (!raw) {
    return { ...base, error: 'Probe produced no output.' };
  }
  return { ...base, ...raw, object, field };
}

/** Writes the script to a temp file, runs `sf apex run --file`, returns parsed JSON. */
async function runProbe(
  sf: SfExecutor,
  script: string,
  cwd: string,
  token?: vscode.CancellationToken
): Promise<any | undefined> {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'siid-probe-')), 'probe.apex');
  fs.writeFileSync(file, script, 'utf-8');
  try {
    // `sf apex run` returns the debug log inline (result.logs) in its JSON.
    const { result } = await sf.run<{ logs?: string; success?: boolean }>(
      ['apex', 'run', '--file', file],
      { cwd, token, acceptNonZeroStatus: true }
    );
    const logs = typeof result?.logs === 'string' ? result.logs : '';
    return parseProbeOutput(logs);
  } catch {
    return undefined;
  }
}

/**
 * Extracts the probe JSON from the debug log. The marker appears twice — once in
 * the echoed source line and once in the real `USER_DEBUG` output — so we only
 * accept the USER_DEBUG line:
 *   ...|USER_DEBUG|[n]|DEBUG|SIID_PROBE::{json}
 */
function parseProbeOutput(logs: string): any | undefined {
  const marker = 'SIID_PROBE::';
  for (const line of logs.split(/\r?\n/)) {
    if (!line.includes('|USER_DEBUG|')) {
      continue;
    }
    const idx = line.indexOf(marker);
    if (idx >= 0) {
      const json = line.slice(idx + marker.length).trim();
      try {
        return JSON.parse(json);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
