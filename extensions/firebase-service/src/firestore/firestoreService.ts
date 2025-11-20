import {
	getFirestore,
	Firestore,
	doc,
	setDoc,
	getDoc,
	updateDoc,
	deleteDoc,
	collection,
	query,
	where,
	getDocs,
	orderBy,
	limit,
	Query,
	CollectionReference
} from '@firebase/firestore';
import { Logger } from '../utils/logger';
import { FirebaseAppManager } from '../utils/firebaseAppManager';

export interface FirestoreDocument {
	id: string;
	data: Record<string, any>;
	createdAt: Date;
	updatedAt: Date;
	userId?: string;
}

export class FirestoreService {
	private firestore: Firestore | null = null;
	private logger: Logger;
	private firebaseAppManager: FirebaseAppManager;
	private isInitialized = false;

	constructor(firebaseAppManager: FirebaseAppManager, logger: Logger) {
		this.firebaseAppManager = firebaseAppManager;
		this.logger = logger;
	}

	async initialize(): Promise<void> {
		try {
			this.logger.info('Initializing Firestore...');

			// Initialize Firestore
			this.firestore = getFirestore(this.firebaseAppManager.getApp());
			this.isInitialized = true;

			this.logger.info('Firestore initialized successfully');
		} catch (error) {
			this.logger.error('Failed to initialize Firestore', error);
			throw error;
		}
	}

	async storeData(collectionName: string, documentId: string, data: Record<string, any>): Promise<void> {
		try {
			if (!this.isInitialized || !this.firestore) {
				throw new Error('Firestore not initialized');
			}

			const docRef = doc(this.firestore, collectionName, documentId);

			// Clean data to remove undefined values (Firestore doesn't support undefined)
			const cleanedData = this.removeUndefinedValues(data);

			const documentData: any = {
				id: documentId,
				data: cleanedData,
				createdAt: new Date(),
				updatedAt: new Date()
			};

			// Only add userId if it's defined
			const userId = this.getCurrentUserId();
			if (userId) {
				documentData.userId = userId;
			}

			await setDoc(docRef, documentData);

			this.logger.debug(`Stored data in ${collectionName}/${documentId}`);
		} catch (error) {
			this.logger.error('Failed to store data', error);
			throw error;
		}
	}

	async retrieveData(collectionName: string, documentId: string): Promise<FirestoreDocument | null> {
		try {
			if (!this.isInitialized || !this.firestore) {
				throw new Error('Firestore not initialized');
			}

			const docRef = doc(this.firestore, collectionName, documentId);
			const docSnap = await getDoc(docRef);

			if (docSnap.exists()) {
				const data = docSnap.data() as FirestoreDocument;
				this.logger.debug(`Retrieved data from ${collectionName}/${documentId}`);
				return data;
			} else {
				this.logger.debug(`Document ${collectionName}/${documentId} not found`);
				return null;
			}
		} catch (error) {
			this.logger.error('Failed to retrieve data', error);
			throw error;
		}
	}

	async updateData(collectionName: string, documentId: string, updates: Record<string, any>): Promise<void> {
		try {
			if (!this.isInitialized || !this.firestore) {
				throw new Error('Firestore not initialized');
			}

			const docRef = doc(this.firestore, collectionName, documentId);
			const updateData = {
				...updates,
				updatedAt: new Date()
			};

			await updateDoc(docRef, updateData);

			this.logger.debug(`Updated data in ${collectionName}/${documentId}`);
		} catch (error) {
			this.logger.error('Failed to update data', error);
			throw error;
		}
	}

	async deleteData(collectionName: string, documentId: string): Promise<void> {
		try {
			if (!this.isInitialized || !this.firestore) {
				throw new Error('Firestore not initialized');
			}

			const docRef = doc(this.firestore, collectionName, documentId);
			await deleteDoc(docRef);

			this.logger.debug(`Deleted data from ${collectionName}/${documentId}`);
		} catch (error) {
			this.logger.error('Failed to delete data', error);
			throw error;
		}
	}

	async queryData(
		collectionName: string,
		filters?: { field: string; operator: string; value: any }[],
		orderByField?: string,
		orderDirection: 'asc' | 'desc' = 'desc',
		limitCount?: number
	): Promise<FirestoreDocument[]> {
		try {
			if (!this.isInitialized || !this.firestore) {
				throw new Error('Firestore not initialized');
			}

			let q: Query | CollectionReference = collection(this.firestore, collectionName);

			// Apply filters
			if (filters && filters.length > 0) {
				const constraints = filters.map(filter => where(filter.field, filter.operator as any, filter.value));
				q = query(q, ...constraints);
			}

			// Apply ordering
			if (orderByField) {
				q = query(q, orderBy(orderByField, orderDirection));
			}

			// Apply limit
			if (limitCount) {
				q = query(q, limit(limitCount));
			}

			const querySnapshot = await getDocs(q);
			const results: FirestoreDocument[] = [];

			querySnapshot.forEach((doc) => {
				results.push(doc.data() as FirestoreDocument);
			});

			this.logger.debug(`Queried ${results.length} documents from ${collectionName}`);
			return results;
		} catch (error) {
			this.logger.error('Failed to query data', error);
			throw error;
		}
	}

	async storeUserPreferences(userId: string, preferences: Record<string, any>): Promise<void> {
		await this.storeData('userPreferences', userId, preferences);
	}

	async getUserPreferences(userId: string): Promise<Record<string, any> | null> {
		const doc = await this.retrieveData('userPreferences', userId);
		return doc ? doc.data : null;
	}

	async storeProjectMetadata(projectId: string, metadata: Record<string, any>): Promise<void> {
		await this.storeData('projectMetadata', projectId, metadata);
	}

	async getProjectMetadata(projectId: string): Promise<Record<string, any> | null> {
		const doc = await this.retrieveData('projectMetadata', projectId);
		return doc ? doc.data : null;
	}

	/**
	 * Store authenticated user's basic data in Firestore
	 */
	async storeUserData(userData: {
		uid: string;
		email?: string | null;
		displayName?: string | null;
		photoURL?: string | null;
		emailVerified?: boolean;
		provider?: string;
	}): Promise<void> {
		try {
			if (!this.isInitialized || !this.firestore) {
				throw new Error('Firestore not initialized');
			}

			const docRef = doc(this.firestore, 'users', userData.uid);

			// Check if user document already exists
			const existingDoc = await getDoc(docRef);
			const now = new Date();

			const userDocument: any = {
				uid: userData.uid,
				email: userData.email || null,
				displayName: userData.displayName || null,
				photoURL: userData.photoURL || null,
				emailVerified: userData.emailVerified || false,
				provider: userData.provider || 'unknown',
				updatedAt: now
			};

			// If document exists, preserve createdAt, otherwise set it
			if (existingDoc.exists()) {
				userDocument.lastLoginAt = now;
			} else {
				userDocument.createdAt = now;
				userDocument.firstLoginAt = now;
			}

			await setDoc(docRef, userDocument, { merge: true });

			this.logger.info(`User data stored for ${userData.uid}`);
		} catch (error) {
			this.logger.error('Failed to store user data', error);
			throw error;
		}
	}

	/**
	 * Retrieve user data from Firestore
	 */
	async getUserData(uid: string): Promise<any | null> {
		try {
			if (!this.isInitialized || !this.firestore) {
				throw new Error('Firestore not initialized');
			}

			const docRef = doc(this.firestore, 'users', uid);
			const docSnap = await getDoc(docRef);

			if (docSnap.exists()) {
				this.logger.debug(`Retrieved user data for ${uid}`);
				return docSnap.data();
			} else {
				this.logger.debug(`No user data found for ${uid}`);
				return null;
			}
		} catch (error) {
			this.logger.error('Failed to retrieve user data', error);
			throw error;
		}
	}

	/**
	 * Get current authenticated user's data
	 * This is a convenience method that can be called by other extensions
	 */
	async getCurrentUserData(): Promise<any | null> {
		try {
			const userId = this.getCurrentUserId();
			if (!userId) {
				return null;
			}
			return await this.getUserData(userId);
		} catch (error) {
			this.logger.error('Failed to get current user data', error);
			return null;
		}
	}

	private getCurrentUserId(): string | undefined {
		// This would typically get the current user ID from the auth service
		// For now, return undefined
		return undefined;
	}

	private removeUndefinedValues(obj: any): any {
		if (obj === null || obj === undefined) {
			return null;
		}

		if (Array.isArray(obj)) {
			return obj.map(item => this.removeUndefinedValues(item));
		}

		if (typeof obj === 'object' && obj.constructor === Object) {
			const cleaned: any = {};
			for (const [key, value] of Object.entries(obj)) {
				if (value !== undefined) {
					cleaned[key] = this.removeUndefinedValues(value);
				}
			}
			return cleaned;
		}

		return obj;
	}

	/**
	 * Check if Firestore is initialized
	 */
	public getInitializationStatus(): boolean {
		return this.isInitialized;
	}

	dispose(): void {
		this.firestore = null;
		this.isInitialized = false;
		this.logger.info('Firestore service disposed');
	}
}
