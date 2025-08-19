import { BitbucketSite } from '../../../../bitbucket/model';
import { Pipeline, PipelineLogRange, PipelineStep } from '../../../../pipelines/model';

export interface PipelinesSummaryActionApi {
    refresh(pipeline: Pipeline): Promise<Pipeline>;
    fetchSteps(site: BitbucketSite, uuid: string, buildNumber: number): Promise<PipelineStep[]>;
    fetchLogRange(
        site: BitbucketSite,
        pipelineUuid: string,
        stepUuid: string,
        range: PipelineLogRange,
    ): Promise<string>;
    rerunPipeline(pipeline: Pipeline): Promise<any>;
}
