import { initializeApp, FirebaseApp } from '@firebase/app';
import * as vscode from 'vscode';
import { Logger } from './logger';
import { FirebaseConfig } from '../types/service.types';

export class FirebaseAppManager {
	private app: FirebaseApp | null = null;
	private logger: Logger;
	private config: FirebaseConfig | null = null;

	constructor(logger: Logger) {
		this.logger = logger;
	}

	async initialize(): Promise<void> {
		try {
			this.logger.info('Initializing Firebase App...');

			// Get Firebase config from authentication extension
			this.config = await this.getFirebaseConfig();

			if (!this.config) {
				throw new Error('Firebase configuration not found. Please ensure firebase-authentication-v1 extension is configured.');
			}

			// Initialize Firebase App
			this.app = initializeApp(this.config);

			this.logger.info('Firebase App initialized successfully');
		} catch (error) {
			this.logger.error('Failed to initialize Firebase App', error);
			throw error;
		}
	}

	private async getFirebaseConfig(): Promise<FirebaseConfig | null> {
		try {
			// Get config from VS Code configuration
			const config = this.getVSCodeConfig();
			if (config && this.isValidConfig(config)) {
				return config;
			}

			// Fallback to environment variables
			const envConfig = this.getEnvConfig();
			if (envConfig && this.isValidConfig(envConfig)) {
				return envConfig;
			}

			return null;
		} catch (error) {
			this.logger.warn('Could not get Firebase config', error);
			return null;
		}
	}

	private getVSCodeConfig(): FirebaseConfig | null {
		const config = {
			apiKey: vscode.workspace.getConfiguration('firebase-service').get<string>('apiKey', ''),
			authDomain: vscode.workspace.getConfiguration('firebase-service').get<string>('authDomain', ''),
			projectId: vscode.workspace.getConfiguration('firebase-service').get<string>('projectId', ''),
			storageBucket: vscode.workspace.getConfiguration('firebase-service').get<string>('storageBucket', ''),
			messagingSenderId: vscode.workspace.getConfiguration('firebase-service').get<string>('messagingSenderId', ''),
			appId: vscode.workspace.getConfiguration('firebase-service').get<string>('appId', '')
		};

		return config;
	}

	private getEnvConfig(): FirebaseConfig | null {
		const config = {
			apiKey: process.env.FIREBASE_API_KEY || '',
			authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
			projectId: process.env.FIREBASE_PROJECT_ID || '',
			storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
			messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
			appId: process.env.FIREBASE_APP_ID || ''
		};

		return config;
	}

	private isValidConfig(config: FirebaseConfig): boolean {
		return !!(config.apiKey && config.authDomain && config.projectId && config.appId);
	}

	getApp(): FirebaseApp {
		if (!this.app) {
			throw new Error('Firebase App not initialized. Call initialize() first.');
		}
		return this.app;
	}

	getConfig(): FirebaseConfig | null {
		return this.config;
	}

	dispose(): void {
		// Firebase apps don't need explicit disposal in this version
		this.app = null;
		this.config = null;
		this.logger.info('Firebase App Manager disposed');
	}
}
