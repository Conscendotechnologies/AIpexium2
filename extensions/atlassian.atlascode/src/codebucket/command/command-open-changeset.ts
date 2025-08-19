import { CommandBase } from './command-base';

export class OpenBitbucketChangesetCommand extends CommandBase {
    protected async execute(): Promise<void> {
        const backend = await this.getBackend();
        const remote = await backend.findBitbucketSite();
        const filePath = this.getFilePath(backend.root);
        const rev = await backend.findSelectedRevision(filePath, this.getCurrentLine());

        this.openUrl(remote.getChangeSetUrl(rev, filePath));
    }
}
