import { BitbucketSite } from '../../bitbucket/model';
import { BitbucketSiteBase } from './bitbucket-site-base';

export class BitbucketServerSite extends BitbucketSiteBase {
    constructor(site: BitbucketSite) {
        super(site);
    }

    public getChangeSetUrl(revision: string, filePath: string): string {
        const { ownerSlug, repoSlug } = this.site;
        return `${
            this.site.details.baseLinkUrl
        }/projects/${ownerSlug}/repos/${repoSlug}/commits/${revision}#${encodeURIComponent(filePath)}`;
    }

    public getSourceUrl(revision: string, filePath: string, lineRanges: string[]): string {
        const { ownerSlug, repoSlug } = this.site;
        const hash = lineRanges.map((range) => range.replace(':', '-')).join(',');
        return `${this.site.details.baseLinkUrl}/projects/${ownerSlug}/repos/${repoSlug}/browse/${encodeURIComponent(
            filePath,
        )}?at=${revision}#${hash}`;
    }

    public getPullRequestUrl(id: string, filePath: string): string {
        const { ownerSlug, repoSlug } = this.site;
        return `${
            this.site.details.baseLinkUrl
        }/projects/${ownerSlug}/repos/${repoSlug}/pull-requests/${id}/diff#${encodeURIComponent(filePath)}`;
    }
}
