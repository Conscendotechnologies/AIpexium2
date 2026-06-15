/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { MENU_ACTIONS } from '../commands';

/**
 * Renders the Forge actions in the activity-bar panel. Each item runs its command.
 */
export class ForgeMenuProvider implements vscode.TreeDataProvider<MenuItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: MenuItem): vscode.TreeItem {
    return element;
  }

  getChildren(): MenuItem[] {
    return MENU_ACTIONS.map((a) => new MenuItem(a.label, a.commandId, a.icon));
  }
}

class MenuItem extends vscode.TreeItem {
  constructor(label: string, commandId: string, icon: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(icon);
    this.command = { command: commandId, title: label };
  }
}
