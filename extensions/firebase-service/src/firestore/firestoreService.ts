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
			const documentData: FirestoreDocument = {
				id: documentId,
				data,
				createdAt: new Date(),
				updatedAt: new Date(),
				userId: this.getCurrentUserId()
			};

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

	private getCurrentUserId(): string | undefined {
		// This would typically get the current user ID from the auth service
		// For now, return undefined
		return undefined;
	}

	dispose(): void {
		this.firestore = null;
		this.isInitialized = false;
		this.logger.info('Firestore service disposed');
	}
}
