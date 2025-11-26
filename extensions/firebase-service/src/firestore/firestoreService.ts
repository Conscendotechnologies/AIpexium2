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
import { AuthManager } from '../auth/authManager';

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
	private authManager: AuthManager;
	private isInitialized = false;

	constructor(firebaseAppManager: FirebaseAppManager, authManager: AuthManager, logger: Logger) {
		this.firebaseAppManager = firebaseAppManager;
		this.authManager = authManager;
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
	 * Get properties from the current user's document (users/{uid})
	 * @param propertyNames Optional array of property names to retrieve. If not provided, returns all data.
	 * @returns User data object with requested properties or null if not found
	 * @example
	 * // Get specific properties
	 * const userData = await getUserProperties(['displayName', 'email']);
	 * console.log(userData.displayName, userData.email);
	 *
	 * // Get all properties
	 * const allData = await getUserProperties();
	 */
	async getUserProperties(propertyNames?: string[]): Promise<any | null> {
		try {
			if (!this.isInitialized || !this.firestore) {
				throw new Error('Firestore not initialized');
			}

			const uid = await this.getCurrentUserId();
			if (!uid) {
				throw new Error('No authenticated user');
			}

			const docRef = doc(this.firestore, 'users', uid);
			const docSnap = await getDoc(docRef);

			if (docSnap.exists()) {
				const data = docSnap.data();

				// If property names are specified, return only those properties
				if (propertyNames && propertyNames.length > 0) {
					const filteredData: any = {};
					for (const prop of propertyNames) {
						if (prop in data) {
							filteredData[prop] = data[prop];
						}
					}
					this.logger.debug(`Retrieved ${propertyNames.length} properties for ${uid}`);
					return filteredData;
				}

				// Otherwise return all data
				this.logger.debug(`Retrieved user properties for ${uid}`);
				return data;
			} else {
				this.logger.debug(`No user data found for ${uid}`);
				return null;
			}
		} catch (error) {
			this.logger.error('Failed to retrieve user properties', error);
			throw error;
		}
	}

	/**
	 * Get properties from user collection (users/{uid})
	 * @param uid User ID
	 * @returns User data object or null if not found
	 * @example
	 * const userData = await getAdminProperties('admin', ['settings', 'config123']);
	 * console.log(userData);
	 */
	async getAdminApiKey(): Promise<any | null> {
		try {
			if (!this.isInitialized || !this.firestore) {
				throw new Error('Firestore not initialized');
			}

			const docRef = doc(this.firestore, 'static-data', 'siid-code', 'adminApiKey');
			const docSnap = await getDoc(docRef);

			if (docSnap.exists()) {
				this.logger.debug(`Retrieved admin properties`);
				return docSnap.data();
			} else {
				this.logger.debug(`No admin data found`);
				return null;
			}
		} catch (error) {
			this.logger.error('Failed to retrieve admin properties', error);
			throw error;
		}
	}

	/**
	 * @deprecated Use getUserProperties instead
	 */
	async getUserData(): Promise<any | null> {
		return this.getUserProperties();
	}

	/**
	 * Fetch user data from Firestore by UID
	 * This is useful for retrieving user data during authentication process
	 * @param uid - User ID to fetch data for
	 * @returns User data object or null if not found
	 */
	async getUserDataByUid(uid: string): Promise<any | null> {
		try {
			if (!this.isInitialized || !this.firestore) {
				throw new Error('Firestore not initialized');
			}

			const docRef = doc(this.firestore, 'users', uid);
			const docSnap = await getDoc(docRef);

			if (docSnap.exists()) {
				this.logger.debug(`Retrieved user data for UID: ${uid}`);
				return docSnap.data();
			} else {
				this.logger.debug(`No user data found for UID: ${uid}`);
				return null;
			}
		} catch (error) {
			this.logger.error(`Failed to retrieve user data for UID: ${uid}`, error);
			throw error;
		}
	}

	/**
	 * Update properties in the current user's document (users/{uid})
	 * Can update one or multiple key-value pairs
	 * @param updates Object containing field names and values to update
	 * @example
	 * // Update single field
	 * await updateUserProperties({ displayName: 'John Doe' });
	 *
	 * // Update multiple fields
	 * await updateUserProperties({
	 *   displayName: 'John Doe',
	 *   email: 'john@example.com',
	 *   photoURL: 'https://...',
	 *   preferences: { theme: 'dark', language: 'en' }
	 * });
	 */
	async updateUserProperties(updates: Record<string, any>): Promise<void> {
		try {
			if (!this.isInitialized || !this.firestore) {
				throw new Error('Firestore not initialized');
			}

			const uid = await this.getCurrentUserId();
			if (!uid) {
				throw new Error('No authenticated user');
			}

			if (!updates || Object.keys(updates).length === 0) {
				throw new Error('No updates provided');
			}

			const docRef = doc(this.firestore, 'users', uid);

			// Clean updates to remove undefined values
			const cleanedUpdates = this.removeUndefinedValues(updates);

			// Add updatedAt timestamp
			const updateData = {
				...cleanedUpdates,
				updatedAt: new Date()
			};

			// Use setDoc with merge to create if not exists, or update if exists
			await setDoc(docRef, updateData, { merge: true });

			this.logger.info(`Updated user properties for ${uid}: ${Object.keys(cleanedUpdates).join(', ')}`);
		} catch (error) {
			const uid = await this.getCurrentUserId();
			this.logger.error(`Failed to update user properties for ${uid}`, error);
			throw error;
		}
	}

	private async getCurrentUserId(): Promise<string | undefined> {
		try {
			const session = await this.authManager.getCurrentUser();
			return session?.uid;
		} catch (error) {
			this.logger.warn('Failed to get current user ID', error);
			return undefined;
		}
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
