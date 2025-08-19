import { AxiosInstance } from 'axios';

/**
 * AuthInterceptor is used to intercept any auth failures and potentially prevent further requests from being sent.
 */
export interface AuthInterceptor {
    attachToAxios(transport: AxiosInstance): Promise<void>;
}
