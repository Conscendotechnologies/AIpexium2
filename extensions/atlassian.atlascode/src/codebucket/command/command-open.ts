import { CommandBase } from './command-base';

export class OpenInBitbucketCommand extends CommandBase {
    protected async execute(): Promise<void> {
        const backend = await this.getBackend();
        const remote = await backend.findBitbucketSite();
        const rev = await backend.findCurrentRevision();
        const filePath = this.getFilePath(backend.root);

        this.openUrl(remote.getSourceUrl(rev, filePath, this.getLineRanges()));
    }
}
