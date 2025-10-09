/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ViewPane, IViewPaneOptions } from '../../../browser/parts/views/viewPane.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IRoocodeService } from '../common/roocode.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import * as dom from '../../../../base/browser/dom.js';
import { localize } from '../../../../nls.js';

/**
 * Roo Code panel that displays the Roo Code UI
 */
export class RoocodePanel extends ViewPane {
	static readonly ID = 'workbench.panel.roocode';
	static readonly TITLE = localize('roocode.panel.title', "Roo Code");

	private contentContainer: HTMLElement | undefined;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IRoocodeService private readonly roocodeService: IRoocodeService,
		@ILogService private readonly logService: ILogService,
		@IContextKeyService contextKeyService: IContextKeyService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);

		this.logService.info('RoocodePanel: Initializing panel');

		// Listen to session changes
		this._register(this.roocodeService.onDidChangeSession(session => {
			this.updateContent(session !== undefined);
		}));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this.contentContainer = dom.append(container, dom.$('.roocode-panel'));

		// Create welcome view
		this.renderWelcomeView();
	}

	private renderWelcomeView(): void {
		if (!this.contentContainer) {
			return;
		}

		dom.clearNode(this.contentContainer);

		const welcomeContainer = dom.append(this.contentContainer, dom.$('.roocode-welcome'));

		// Title
		const title = dom.append(welcomeContainer, dom.$('h2'));
		title.textContent = localize('roocode.welcome.title', "Welcome to Roo Code");

		// Description
		const description = dom.append(welcomeContainer, dom.$('p'));
		description.textContent = localize('roocode.welcome.description', "Roo Code is an AI-powered autonomous coding agent that helps you with code generation, architecture design, debugging, and more.");

		// Features list
		const featuresTitle = dom.append(welcomeContainer, dom.$('h3'));
		featuresTitle.textContent = localize('roocode.welcome.features', "Features:");

		const featuresList = dom.append(welcomeContainer, dom.$('ul'));
		const features = [
			localize('roocode.feature.code', "Code Mode: Generate and edit code with AI assistance"),
			localize('roocode.feature.architect', "Architect Mode: Design system architecture"),
			localize('roocode.feature.ask', "Ask Mode: Get answers to technical questions"),
			localize('roocode.feature.debug', "Debug Mode: Find and fix bugs"),
			localize('roocode.feature.custom', "Custom Mode: Create custom workflows")
		];

		features.forEach(feature => {
			const li = dom.append(featuresList, dom.$('li'));
			li.textContent = feature;
		});

		// Start button
		const buttonContainer = dom.append(welcomeContainer, dom.$('.roocode-actions'));
		const startButton = dom.append(buttonContainer, dom.$('button.monaco-button.monaco-text-button'));
		startButton.textContent = localize('roocode.welcome.start', "Start Roo Code Session");

		this._register(dom.addDisposableListener(startButton, dom.EventType.CLICK, async () => {
			await this.roocodeService.startSession();
		}));
	}

	private updateContent(sessionActive: boolean): void {
		if (!this.contentContainer) {
			return;
		}

		if (sessionActive) {
			this.renderActiveSessionView();
		} else {
			this.renderWelcomeView();
		}
	}

	private renderActiveSessionView(): void {
		if (!this.contentContainer) {
			return;
		}

		dom.clearNode(this.contentContainer);

		const sessionContainer = dom.append(this.contentContainer, dom.$('.roocode-session'));

		// Session status
		const statusBar = dom.append(sessionContainer, dom.$('.roocode-status-bar'));
		const statusText = dom.append(statusBar, dom.$('span'));
		statusText.textContent = localize('roocode.session.active', "Session Active");

		// Stop button
		const stopButton = dom.append(statusBar, dom.$('button.monaco-button'));
		stopButton.textContent = localize('roocode.session.stop', "Stop Session");

		this._register(dom.addDisposableListener(stopButton, dom.EventType.CLICK, async () => {
			await this.roocodeService.stopSession();
		}));

		// Chat/interaction area (placeholder for now)
		const chatArea = dom.append(sessionContainer, dom.$('.roocode-chat-area'));
		const chatPlaceholder = dom.append(chatArea, dom.$('p'));
		chatPlaceholder.textContent = localize('roocode.chat.placeholder', "Chat interface will be implemented here. This will provide a conversational interface for interacting with Roo Code.");
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		// Layout logic if needed
	}
}
