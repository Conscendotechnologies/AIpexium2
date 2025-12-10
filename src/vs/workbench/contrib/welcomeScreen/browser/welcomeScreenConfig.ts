/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IWelcomeScreenConfig {
	screens: IScreenConfig[];
}

export interface IScreenConfig {
	id: string;
	title: string;
	subtitle: string;
	type: 'welcome' | 'content' | 'final' | 'import';
	buttons?: IButtonConfig[];
	content?: string;
	importOptions?: IImportOption[];
}

export interface IButtonConfig {
	label: string;
	action: 'next' | 'back' | 'finish' | 'importSettings';
	primary?: boolean;
}

export interface IFeatureConfig {
	id: string;
	title: string;
	description: string;
	icon: string;
}

export interface IImportOption {
	id: string;
	label: string;
	description: string;
	icon: string;
	selected?: boolean;
}

// Default welcome screen configuration
export const defaultWelcomeScreenConfig: IWelcomeScreenConfig = {
	screens: [
		{
			id: 'welcome',
			title: 'Welcome to SIID',
			subtitle: 'Your intelligent coding companion',
			type: 'welcome',
			buttons: [
				{
					label: 'Next',
					action: 'next',
					primary: true
				}
			]
		},
		{
			id: 'import-settings',
			title: 'Your settings',
			subtitle: 'Import your settings, including extensions, settings, keyboard shortcuts, snippets, etc.',
			type: 'import',
			importOptions: [
				{
					id: 'vsCode',
					label: 'Import from VS Code',
					description: 'Bring your preferences from VS Code',
					icon: 'vscode',
					selected: false
				}
			],
			buttons: [
				{
					label: 'Skip',
					action: 'next',
					primary: false
				},
				{
					label: 'Confirm and Continue',
					action: 'importSettings',
					primary: true
				}
			]
		},
		{
			id: 'features',
			title: 'About SIID',
			subtitle: 'Your Ultimate Salesforce Development Environment',
			type: 'content',
			content: `
• Objects & Fields       		• Profiles
• Bulk Field Creation           • Permissions
• Record Types           		• Roles
• Build Paths                   • Validation Rules
• Assignment Rules              • LWC Components
• Apex Development              • Flows
`,
			buttons: [
				{
					label: 'Back',
					action: 'back',
					primary: false
				},
				{
					label: 'Next',
					action: 'next',
					primary: true
				}
			]
		},
		{
			id: 'getting-started',
			title: 'Ready to Start!',
			subtitle: 'Everything is set up. Let\'s begin coding!',
			type: 'final',
			buttons: [
				{
					label: 'Back',
					action: 'back',
					primary: false
				},
				{
					label: 'Get Started',
					action: 'finish',
					primary: true
				}
			]
		}
	]
};
