import { CancelTokenSource } from 'axios';

export type CancellationManager = Map<string, CancelTokenSource>;
