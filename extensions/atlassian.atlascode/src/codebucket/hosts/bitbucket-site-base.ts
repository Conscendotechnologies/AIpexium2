import { BitbucketSite } from '../../bitbucket/model';

export abstract class BitbucketSiteBase {
    constructor(protected site: BitbucketSite) {}

    public abstract getChangeSetUrl(revision: string, filePath: string): string;
    public abstract getSourceUrl(revision: string, filePath: string, lineRanges: string[]): string;
    public abstract getPullRequestUrl(id: string, filePath: string): string;
}
