import { CommonAction } from '../../../ipc/fromUI/common';

export interface CommonActionMessageHandler {
    onMessageReceived: (msg: CommonAction) => Promise<void>;
}
