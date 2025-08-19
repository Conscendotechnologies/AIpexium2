import { AnalyticsClientMapper } from './analytics';

describe('AnalyticsClientMapper', () => {
    let analyticsClient: any;
    let identifiers: any;
    let analyticsClientMapper: AnalyticsClientMapper;
    const event = {
        action: 'some-action',
        actionSubject: 'some-subject',
        source: 'some-source',
    };

    beforeEach(() => {
        analyticsClient = {
            sendOperationalEvent: jest.fn(),
        };
        identifiers = {
            analyticsAnonymousId: 'some-id',
        };
        analyticsClientMapper = new AnalyticsClientMapper(analyticsClient, identifiers);
    });

    describe('sendOperationalEvent', () => {
        it('should send an operational event', () => {
            analyticsClientMapper.sendOperationalEvent(event);
            expect(analyticsClient.sendOperationalEvent).toHaveBeenCalled();
        });

        it('should map anonymous ID correctly ', () => {
            analyticsClientMapper.sendOperationalEvent(event);
            expect(analyticsClient.sendOperationalEvent).toHaveBeenCalledWith({
                operationalEvent: {
                    ...event,
                },
                anonymousId: 'some-id',
            });
        });

        it('should map atlassianAccountId correctly', () => {
            identifiers = {
                atlassianAccountId: 'some-account-id',
                analyticsAnonymousId: 'some-id',
            };
            analyticsClientMapper = new AnalyticsClientMapper(analyticsClient, identifiers);
            analyticsClientMapper.sendOperationalEvent(event);
            expect(analyticsClient.sendOperationalEvent).toHaveBeenCalledWith({
                operationalEvent: {
                    ...event,
                },
                userId: 'some-account-id',
                userIdType: 'atlassianAccount',
                anonymousId: 'some-id', // Still present
            });
        });
    });
});
