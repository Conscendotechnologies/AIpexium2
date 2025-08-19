import { CommandBase } from './command-base';

export abstract class BitbucketPullRequestCommand extends CommandBase {
    protected async pullRequestUrl(): Promise<string> {
        const backend = await this.getBackend();
        const remote = await backend.findBitbucketSite();
        const filePath = this.getFilePath(backend.root);
        const targetRevision = await backend.findSelectedRevision(filePath, this.getCurrentLine());
        const id = await backend.getPullRequestId(targetRevision);
        return Promise.resolve(remote.getPullRequestUrl(id, filePath));
    }
}
