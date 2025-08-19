import { ProductBitbucket, ProductJira } from '../atlclients/authInfo';
import { Container } from '../container';
import { FeedbackUser } from '../lib/ipc/models/common';

export async function getFeedbackUser(): Promise<FeedbackUser> {
    let firstAvailableUser: FeedbackUser | undefined = undefined;

    const jiraCloudSites = Container.siteManager.getSitesAvailable(ProductJira).filter((site) => site.isCloud);
    if (jiraCloudSites.length > 0) {
        const jiraUser = await Container.credentialManager.getAuthInfo(jiraCloudSites[0]);
        if (jiraUser) {
            firstAvailableUser = {
                userName: jiraUser.user.displayName,
                emailAddress: jiraUser.user.email,
            };
        }
    }

    if (!firstAvailableUser) {
        const bitbucketCloudSites = Container.siteManager
            .getSitesAvailable(ProductBitbucket)
            .filter((site) => site.isCloud);
        if (bitbucketCloudSites.length > 0) {
            const bbUser = await Container.credentialManager.getAuthInfo(bitbucketCloudSites[0]);
            if (bbUser) {
                firstAvailableUser = {
                    userName: bbUser.user.displayName,
                    emailAddress: bbUser.user.email,
                };
            }
        }
    }
    return firstAvailableUser || { userName: '', emailAddress: '' };
}
