/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'fs';
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { FormulaReturnType } from '../core/formulaEval';
import { getWorkspaceCwd } from '../core/workspace';
import { ensureDefaultOrg } from '../ui/orgGuard';
import { Feature } from './types';
import { FormulaEvalPanel, FormulaPanelSeed } from './formulaEvalPanel';

/**
 * Thin launcher for the interactive Formula Evaluation webview (§14: the panel is
 * a UI over the headless `evaluateFormula` service; the SDK/agent call the service
 * directly). The command opens the panel, seeding it from a selected Flow formula
 * when invoked on a `.flow-meta.xml` file; all input + iteration then happens in
 * the webview form (no command-palette prompts).
 */

/** Maps a Flow `dataType` to a `FormulaEval.FormulaReturnType`. */
function mapFlowDataType(dataType: string): FormulaReturnType | undefined {
  const m: Record<string, FormulaReturnType> = {
    String: 'STRING', Text: 'STRING', Picklist: 'STRING',
    Boolean: 'BOOLEAN',
    Number: 'DECIMAL', Currency: 'DECIMAL', Percent: 'DECIMAL', Double: 'DOUBLE',
    Integer: 'INTEGER', Long: 'LONG',
    Date: 'DATE', DateTime: 'DATETIME', Time: 'TIME'
  };
  return m[dataType];
}

/** Pulls `<object>` and the matching `<formulas>`'s `<dataType>` out of Flow XML (no XML dep). */
function readFlowContext(xml: string, selected: string): { objectName?: string; returnType?: FormulaReturnType } {
  const objectName = /<object>([^<]+)<\/object>/.exec(xml)?.[1]?.trim();
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const wanted = norm(selected);
  let returnType: FormulaReturnType | undefined;
  const re = /<formulas>([\s\S]*?)<\/formulas>/g;
  let block: RegExpExecArray | null;
  while ((block = re.exec(xml))) {
    const expr = /<expression>([\s\S]*?)<\/expression>/.exec(block[1])?.[1];
    if (expr && (norm(expr).includes(wanted) || wanted.includes(norm(expr)))) {
      const dt = /<dataType>([^<]+)<\/dataType>/.exec(block[1])?.[1]?.trim();
      if (dt) {
        returnType = mapFlowDataType(dt);
      }
      break;
    }
  }
  return { objectName, returnType };
}

export const registerFormulaEval: Feature = ({ context, sf, logger, orgs, trace, schema }) => {
  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.evaluateFormula, async (arg?: vscode.Uri): Promise<void> => {
      const root = getWorkspaceCwd();
      if (!root) {
        return;
      }
      if (!(await ensureDefaultOrg(orgs))) {
        return;
      }

      // Seed from a Flow XML selection when invoked from that context.
      let seed: FormulaPanelSeed | undefined;
      const editor = vscode.window.activeTextEditor;
      const selected = editor?.document.getText(editor.selection).trim();
      const flowUri = arg ?? editor?.document.uri;
      if (selected && flowUri?.fsPath.endsWith('.flow-meta.xml')) {
        try {
          const xml = fs.readFileSync(flowUri.fsPath, 'utf-8');
          seed = { formula: selected, ...readFlowContext(xml, selected) };
        } catch (e: any) {
          logger.error(`formulaEval: reading flow XML failed: ${e.message}`);
          seed = { formula: selected };
        }
      }

      FormulaEvalPanel.show(
        { sf, orgs, trace, logger, root, objectNames: schema.listObjects(root) },
        seed
      );
    })
  );
};
