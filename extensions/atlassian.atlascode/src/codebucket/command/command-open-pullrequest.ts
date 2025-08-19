import { BitbucketPullRequestCommand } from './command-pullrequest';

export class OpenBitbucketPullRequestCommand extends BitbucketPullRequestCommand {
    protected async execute(): Promise<void> {
        const url = await this.pullRequestUrl();
        this.openUrl(url);
    }
}
