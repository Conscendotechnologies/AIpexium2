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
  createLwc: 'siid-forge.createLwc',
  createTrigger: 'siid-forge.createTrigger',
  createAura: 'siid-forge.createAura',
  executeAnonApex: 'siid-forge.executeAnonApex',
  replayLog: 'siid-forge.replayLog',
  deploySource: 'siid-forge.deploySource',
  retrieveSource: 'siid-forge.retrieveSource',
  deleteSource: 'siid-forge.deleteSource',
  selectOrg: 'siid-forge.selectOrg',
  authorizeOrg: 'siid-forge.authorizeOrg',
  openOrg: 'siid-forge.openOrg',
  runApexTests: 'siid-forge.runApexTests',
  toggleCoverage: 'siid-forge.toggleCoverage',
  refreshCoverage: 'siid-forge.refreshCoverage',
  runSoql: 'siid-forge.runSoql',
  retrieveMetadata: 'siid-forge.retrieveMetadata',
  refreshSchema: 'siid-forge.refreshSchema',
  refreshObjectSchema: 'siid-forge.refreshObjectSchema',
  refreshApexSchema: 'siid-forge.refreshApexSchema',
  refreshLwcSchema: 'siid-forge.refreshLwcSchema',
  describeObject: 'siid-forge.describeObject',
  cacheObjectSchema: 'siid-forge.cacheObjectSchema',
  refreshMenu: 'siid-forge.refreshMenu'
} as const;

/**
 * Actions shown in the Forge activity-bar menu, in display order.
 */
export interface MenuAction {
  label: string;
  commandId: string;
  icon: string;
}

export const MENU_ACTIONS: MenuAction[] = [
  { label: 'Check sf CLI Version', commandId: Commands.checkVersion, icon: 'info' },
  { label: 'Create Project (with manifest)', commandId: Commands.createProject, icon: 'new-folder' },
  { label: 'Create Apex Class', commandId: Commands.createApexClass, icon: 'symbol-class' },
  { label: 'Create Test Class', commandId: Commands.createTestClass, icon: 'beaker' },
  { label: 'Create Apex Trigger', commandId: Commands.createTrigger, icon: 'zap' },
  { label: 'Create LWC Component', commandId: Commands.createLwc, icon: 'symbol-event' },
  { label: 'Create Aura Component', commandId: Commands.createAura, icon: 'symbol-misc' },
  { label: 'Execute Anonymous Apex', commandId: Commands.executeAnonApex, icon: 'run' },
  { label: 'Run SOQL Query', commandId: Commands.runSoql, icon: 'database' },
  { label: 'Retrieve Metadata', commandId: Commands.retrieveMetadata, icon: 'cloud-download' }
];
