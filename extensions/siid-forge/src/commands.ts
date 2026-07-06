/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Central registry of Forge command ids. Keep these in sync with the `commands`
 * declared in package.json.
 */
export const Commands = {
  checkVersion: 'siid-forge.checkVersion',
  updateCli: 'siid-forge.updateCli',
  createProject: 'siid-forge.createProject',
  createApexClass: 'siid-forge.createApexClass',
  createTestClass: 'siid-forge.createTestClass',
  scaffoldApexTest: 'siid-forge.scaffoldApexTest',
  generateApexTestAi: 'siid-forge.generateApexTestAi',
  generateApexTestsBatch: 'siid-forge.generateApexTestsBatch',
  createLwc: 'siid-forge.createLwc',
  createTrigger: 'siid-forge.createTrigger',
  createAura: 'siid-forge.createAura',
  executeAnonApex: 'siid-forge.executeAnonApex',
  replayLog: 'siid-forge.replayLog',
  deploySource: 'siid-forge.deploySource',
  retrieveSource: 'siid-forge.retrieveSource',
  deployToOrg: 'siid-forge.deployToOrg',
  retrieveFromOrg: 'siid-forge.retrieveFromOrg',
  orgCompare: 'siid-forge.orgCompare',
  deleteSource: 'siid-forge.deleteSource',
  selectOrg: 'siid-forge.selectOrg',
  authorizeOrg: 'siid-forge.authorizeOrg',
  authorizeOrgWithToken: 'siid-forge.authorizeOrgWithToken',
  openOrg: 'siid-forge.openOrg',
  orgActions: 'siid-forge.orgActions',
  runApexTests: 'siid-forge.runApexTests',
  toggleCoverage: 'siid-forge.toggleCoverage',
  refreshCoverage: 'siid-forge.refreshCoverage',
  refreshCoverageLens: 'siid-forge.refreshCoverageLens',
  runSoql: 'siid-forge.runSoql',
  retrieveMetadata: 'siid-forge.retrieveMetadata',
  fieldImpact: 'siid-forge.fieldImpact',
  renameSymbol: 'siid-forge.renameSymbol',
  scaffoldLwcTest: 'siid-forge.scaffoldLwcTest',
  runLwcTests: 'siid-forge.runLwcTests',
  generateLwcTestAi: 'siid-forge.generateLwcTestAi',
  setOpenRouterKey: 'siid-forge.setOpenRouterKey',
  refreshSchema: 'siid-forge.refreshSchema',
  refreshObjectSchema: 'siid-forge.refreshObjectSchema',
  refreshApexSchema: 'siid-forge.refreshApexSchema',
  refreshLwcSchema: 'siid-forge.refreshLwcSchema',
  describeObject: 'siid-forge.describeObject',
  cacheObjectSchema: 'siid-forge.cacheObjectSchema',
  /** Internal: repaint the Schema tree after an event-driven sync. */
  refreshSchemaTree: 'siid-forge.refreshSchemaTree',
  refreshMenu: 'siid-forge.refreshMenu',
  getApi: 'siid-forge.getApi'
} as const;

/**
 * A single runnable action in the Forge activity-bar menu.
 */
export interface MenuAction {
  label: string;
  commandId: string;
  icon: string;
}

/**
 * A collapsible section of the Forge activity-bar menu. Sections mirror the
 * top-level Forge menubar groups so the panel is scannable and the two surfaces
 * share the same mental model. Only context-free commands live here — commands
 * that act on the selected file (deploy, run tests, rename…) live in the
 * editor/explorer context menus instead.
 */
export interface MenuSection {
  label: string;
  icon: string;
  actions: MenuAction[];
}

export const MENU_SECTIONS: MenuSection[] = [
  {
    label: 'Create', icon: 'new-folder', actions: [
      { label: 'Create Project (with manifest)', commandId: Commands.createProject, icon: 'new-folder' },
      { label: 'Create Apex Class', commandId: Commands.createApexClass, icon: 'symbol-class' },
      { label: 'Create Test Class', commandId: Commands.createTestClass, icon: 'beaker' },
      { label: 'Create Apex Trigger', commandId: Commands.createTrigger, icon: 'zap' },
      { label: 'Create LWC Component', commandId: Commands.createLwc, icon: 'symbol-event' },
      { label: 'Create Aura Component', commandId: Commands.createAura, icon: 'symbol-misc' }
    ]
  },
  {
    label: 'Run', icon: 'run', actions: [
      { label: 'Run SOQL Query', commandId: Commands.runSoql, icon: 'database' },
      { label: 'Retrieve Metadata', commandId: Commands.retrieveMetadata, icon: 'cloud-download' },
      { label: 'Compare Orgs…', commandId: Commands.orgCompare, icon: 'git-compare' }
    ]
  },
  {
    label: 'Test (AI)', icon: 'sparkle', actions: [
      { label: 'Scaffold Apex Test (smart)', commandId: Commands.scaffoldApexTest, icon: 'beaker' },
      { label: 'Generate Apex Test with AI', commandId: Commands.generateApexTestAi, icon: 'sparkle' },
      { label: 'Generate Apex Tests (batch)…', commandId: Commands.generateApexTestsBatch, icon: 'sparkle' },
      { label: 'Scaffold LWC Jest Test', commandId: Commands.scaffoldLwcTest, icon: 'beaker' },
      { label: 'Generate LWC Test with AI', commandId: Commands.generateLwcTestAi, icon: 'sparkle' }
    ]
  },
  {
    label: 'Refactor', icon: 'symbol-keyword', actions: [
      { label: 'Field / Object Impact…', commandId: Commands.fieldImpact, icon: 'references' },
      { label: 'Rename Symbol…', commandId: Commands.renameSymbol, icon: 'symbol-keyword' }
    ]
  },
  {
    label: 'Settings', icon: 'gear', actions: [
      { label: 'Set OpenRouter API Key', commandId: Commands.setOpenRouterKey, icon: 'key' },
      { label: 'Check sf CLI Version', commandId: Commands.checkVersion, icon: 'info' }
    ]
  }
];
