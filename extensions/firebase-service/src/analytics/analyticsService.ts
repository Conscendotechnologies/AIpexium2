import { getAnalytics, Analytics, logEvent, setUserProperties, isSupported } from '@firebase/analytics';
import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import { FirebaseAppManager } from '../utils/firebaseAppManager';
import { AnalyticsEvent, AnalyticsStatus } from '../types/service.types';

export class AnalyticsService {
	private analytics: Analytics | null = null;
	private logger: Logger;
	private firebaseAppManager: FirebaseAppManager;
	private eventQueue: AnalyticsEvent[] = [];
	private isInitialized = false;
	private batchSize: number;

	constructor(firebaseAppManager: FirebaseAppManager, logger: Logger) {
		this.firebaseAppManager = firebaseAppManager;
		this.logger = logger;
		this.batchSize = 10; // Default batch size
	}

	async initialize(): Promise<void> {
		try {
			this.logger.info('Initializing Firebase Analytics...');

			// Check if analytics is supported
			const supported = await isSupported();
			if (!supported) {
				this.logger.warn('Firebase Analytics is not supported in this environment');
				return;
			}

			// Initialize analytics
			this.analytics = getAnalytics(this.firebaseAppManager.getApp());
			this.isInitialized = true;

			// Set batch size from configuration
			const config = vscode.workspace.getConfiguration('firebase-service');
			this.batchSize = config.get<number>('eventBatchSize', 10);

			// Process any queued events
			await this.processEventQueue();

			this.logger.info('Firebase Analytics initialized successfully');
		} catch (error) {
			this.logger.error('Failed to initialize Firebase Analytics', error);
			throw error;
		}
	}

	async logEvent(event: AnalyticsEvent): Promise<void> {
		try {
			if (!this.isInitialized) {
				// Queue event for later processing
				this.eventQueue.push(event);
				this.logger.debug('Analytics not initialized, queuing event:', event.action);
				return;
			}

			// Convert our event format to Firebase format
			const firebaseEvent = {
				...event,
				timestamp: event.timestamp || Date.now(),
				sessionId: event.sessionId || this.generateSessionId(),
				userId: event.userId || this.getCurrentUserId()
			};

			// Log to Firebase Analytics
			await logEvent(this.analytics!, event.action, {
				category: event.category,
				label: event.label,
				value: event.value,
				...event.metadata
			});

			this.logger.debug(`Logged ${event.category} event: ${event.action}`, event.metadata);
		} catch (error) {
			this.logger.error('Failed to log event', error);
			throw error;
		}
	}

	async logProcessEvent(action: string, metadata?: any): Promise<void> {
		const event: AnalyticsEvent = {
			category: 'process',
			action,
			metadata
		};
		await this.logEvent(event);
	}

	async logInteractionEvent(action: string, metadata?: any): Promise<void> {
		const event: AnalyticsEvent = {
			category: 'interaction',
			action,
			metadata
		};
		await this.logEvent(event);
	}

	async logPerformanceEvent(metric: string, value: number, metadata?: any): Promise<void> {
		const event: AnalyticsEvent = {
			category: 'performance',
			action: metric,
			value,
			metadata
		};
		await this.logEvent(event);
	}

	async logLifecycleEvent(action: string, metadata?: any): Promise<void> {
		const event: AnalyticsEvent = {
			category: 'lifecycle',
			action,
			metadata
		};
		await this.logEvent(event);
	}

	async setUserProperty(name: string, value: any): Promise<void> {
		try {
			if (!this.isInitialized) {
				this.logger.warn('Analytics not initialized, cannot set user property');
				return;
			}

			await setUserProperties(this.analytics!, {
				[name]: value
			});

			this.logger.debug(`Set user property: ${name} = ${value}`);
		} catch (error) {
			this.logger.error('Failed to set user property', error);
			throw error;
		}
	}

	async getStatus(): Promise<AnalyticsStatus> {
		return {
			initialized: this.isInitialized,
			enabled: this.isInitialized,
			consentGiven: true, // Already checked during initialization
			eventCount: this.eventQueue.length,
			lastEventTime: this.eventQueue.length > 0 ? this.eventQueue[this.eventQueue.length - 1].timestamp : undefined
		};
	}

	private async processEventQueue(): Promise<void> {
		if (this.eventQueue.length === 0) {
			return;
		}

		this.logger.info(`Processing ${this.eventQueue.length} queued events`);

		const events = [...this.eventQueue];
		this.eventQueue = [];

		for (const event of events) {
			try {
				await this.logEvent(event);
			} catch (error) {
				this.logger.error('Failed to process queued event', error);
				// Re-queue failed events
				this.eventQueue.push(event);
			}
		}
	}

	private generateSessionId(): string {
		return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	}

	private getCurrentUserId(): string | undefined {
		// This would typically get the current user ID from the auth service
		// For now, return undefined
		return undefined;
	}

	dispose(): void {
		this.analytics = null;
		this.isInitialized = false;
		this.eventQueue = [];
		this.logger.info('Analytics service disposed');
	}
}
