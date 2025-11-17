export interface FirebaseConfig {
	apiKey: string;
	authDomain: string;
	projectId: string;
	storageBucket: string;
	messagingSenderId: string;
	appId: string;
}

export interface AnalyticsEvent {
	category: 'process' | 'interaction' | 'performance' | 'lifecycle';
	action: string;
	label?: string;
	value?: number;
	metadata?: Record<string, any>;
	timestamp?: number;
	sessionId?: string;
	userId?: string;
}

export interface ProcessEvent extends AnalyticsEvent {
	category: 'process';
	action: 'file_opened' | 'file_saved' | 'file_closed' | 'build_started' | 'build_completed' | 'debug_started' | 'debug_stopped' | 'test_run' | 'extension_activated';
}

export interface InteractionEvent extends AnalyticsEvent {
	category: 'interaction';
	action: 'command_executed' | 'menu_clicked' | 'button_clicked' | 'search_performed' | 'settings_changed';
}

export interface PerformanceEvent extends AnalyticsEvent {
	category: 'performance';
	action: 'response_time' | 'memory_usage' | 'cpu_usage' | 'error_rate';
	value: number; // Required for performance events
}

export interface LifecycleEvent extends AnalyticsEvent {
	category: 'lifecycle';
	action: 'session_start' | 'session_end' | 'workspace_opened' | 'workspace_closed';
}

export interface UserProperty {
	name: string;
	value: string | number | boolean;
}

export interface FirestoreDocument {
	id: string;
	data: Record<string, any>;
	createdAt: Date;
	updatedAt: Date;
}

export interface AnalyticsStatus {
	initialized: boolean;
	enabled: boolean;
	consentGiven: boolean;
	eventCount?: number;
	lastEventTime?: number;
	error?: string;
}

export interface ServiceStatus {
	analytics: AnalyticsStatus;
	firestore: {
		initialized: boolean;
		enabled: boolean;
		error?: string;
	};
}
