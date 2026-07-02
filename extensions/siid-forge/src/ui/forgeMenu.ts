/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { MENU_SECTIONS, MenuSection } from '../commands';

/**
 * Renders the Forge actions in the activity-bar panel, grouped into collapsible
 * sections (Create / Run / Test / Refactor / Settings) that mirror the top-level
 * Forge menubar. Sections make the panel scannable; each leaf runs its command.
 */
export class ForgeMenuProvider implements vscode.TreeDataProvider<ForgeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ForgeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ForgeNode): ForgeNode[] {
    // Top level: one node per section. Section level: its actions.
    if (!element) {
      return MENU_SECTIONS.map((s) => new SectionItem(s));
    }
    if (element instanceof SectionItem) {
      return element.section.actions.map((a) => new ActionItem(a.label, a.commandId, a.icon));
    }
    return [];
  }
}

type ForgeNode = SectionItem | ActionItem;

/** A collapsible section header. Expanded by default so actions stay visible. */
class SectionItem extends vscode.TreeItem {
  constructor(readonly section: MenuSection) {
    super(section.label, vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = new vscode.ThemeIcon(section.icon);
    this.contextValue = 'siidForgeSection';
  }
}

/** A leaf action that runs its command when clicked. */
class ActionItem extends vscode.TreeItem {
  constructor(label: string, commandId: string, icon: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(icon);
    this.command = { command: commandId, title: label };
    this.contextValue = 'siidForgeAction';
  }
}
