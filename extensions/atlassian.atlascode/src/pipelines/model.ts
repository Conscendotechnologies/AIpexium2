import { BitbucketSite, Repo } from '../bitbucket/model';

export interface PaginatedPipelines {
    values: Pipeline[];
    page: number;
    size: number;
    pagelen: number;
}

export interface Pipeline {
    site: BitbucketSite;
    repository: Repo;
    build_number: number;
    created_on: string;
    creator_name?: string;
    creator_avatar?: string;
    state: PipelineState;
    uuid: string;
    target: PipelineTarget;
    triggerName?: string;
    completed_on?: string;
    duration_in_seconds?: number;
}

export enum Status {
    Pending,
    InProgress,
    Paused,
    Stopped,
    Successful,
    Error,
    Failed,
    NotRun,
    Unknown,
}

export interface PipelineState {
    name: string;
    type: string;
    result?: PipelineResult;
    stage?: PipelineStage;
}

export interface PipelineResult {
    name: string;
    type: string;
}

export interface PipelineStage {
    name: string;
    type: string;
}

export enum PipelineSelectorType {
    Branch = 'branches',
    Tag = 'tags',
    Bookmark = 'bookmarks',
    Custom = 'custom',
    PullRequests = 'pull-requests',
    Default = 'default',
}

export interface PipelineSelector {
    pattern?: string;
    type: PipelineSelectorType;
}

export enum PipelineTargetType {
    Reference = 'pipeline_ref_target',
    Commit = 'pipeline_commit_target',
    PullRequest = 'pipeline_pullrequest_target',
}

export enum PipelineReferenceType {
    Branch = 'branch',
    NamedBranch = 'named_branch',
    Tag = 'tag',
    AnnotatedTag = 'annotated_tag',
    Bookmark = 'bookmark',
}

export interface PipelineTarget {
    type: PipelineTargetType;
    ref_name?: string;
    selector?: PipelineSelector;
    branch_name?: string;
    commit?: PipelineTargetCommit;
    source?: string;
    destination?: string;
}

// Per https://api.bitbucket.org/swagger.json this should be the same as a Bitbucket Commit object, but there are some
// values missing on the object returned by Pipelines that aren't optional on the Bitbucket object. Creating a parallel
// implementation with just the information returned by Pipelines.
export interface PipelineTargetCommit {
    type: string;
    message: string;
    hash: string;
    links: any;
    summary: PipelineCommitSummary;
}

export interface PipelineCommitSummary {
    raw: string;
    markup: string;
    html: string;
    type: string;
}

// Leaving this here to match the (implied) model of the API.
export interface PipelineCommitTarget extends PipelineTarget {}

export interface PipelinePullRequestTarget extends PipelineTarget {
    source: string;
    destination: string;
    destination_revision?: string;
    pull_request_id: number;
}

export interface PipelineReferenceTarget extends PipelineTarget {
    ref_name: string;
    ref_type: PipelineReferenceType;
}

export enum PipelineLogStage {
    SETUP,
    BUILD,
    TEARDOWN,
}

export interface PipelineLogReference {
    stepIndex: number;
    stage: PipelineLogStage;
    commandIndex?: number;
}

export interface PipelineStep {
    run_number: number;
    uuid: string;
    name?: string;
    completed_on?: string;
    setup_commands: PipelineCommand[];
    setup_logs?: string;
    setup_log_range?: PipelineLogRange;
    script_commands: PipelineCommand[];
    teardown_commands: PipelineCommand[];
    teardown_logs?: string;
    teardown_log_range?: PipelineLogRange;
    duration_in_seconds: number;
    state?: PipelineState;
}

export interface PipelineCommand {
    action?: string;
    command: string;
    name: string;
    logs?: string;
    log_range?: PipelineLogRange;
}

export interface PipelineStepLogRanges {
    setupLogRange: PipelineLogRange;
    buildLogRanges: PipelineLogRange[];
    teardownLogRange: PipelineLogRange;
}

export interface PipelineLogRange {
    firstByte: number;
    byteCount: number;
    lastByte: number;
}

export function statusForState(state: PipelineState): Status {
    if (!state) {
        return Status.Unknown;
    }
    switch (state.type) {
        case 'pipeline_state_completed':
        // fall through
        case 'pipeline_step_state_completed':
            return statusForResult(state.result!);
        case 'pipeline_state_in_progress':
        // fall through
        case 'pipeline_step_state_in_progress':
            return statusForStage(state.stage);
        case 'pipeline_state_pending':
            return Status.Pending;
        case 'pipeline_step_state_pending':
            return statusForStage(state.stage);
        default:
            return Status.Unknown;
    }
}

function statusForResult(result: PipelineResult): Status {
    switch (result.type) {
        case 'pipeline_state_completed_successful':
        // fall through
        case 'pipeline_step_state_completed_successful':
            return Status.Successful;
        case 'pipeline_state_completed_error':
        // fall through
        case 'pipeline_step_state_completed_error':
            return Status.Error;
        case 'pipeline_state_completed_failed':
        // fall through
        case 'pipeline_step_state_completed_failed':
            return Status.Failed;
        case 'pipeline_state_completed_stopped':
        // fall through
        case 'pipeline_step_state_completed_stopped':
            return Status.Stopped;
        case 'pipeline_step_state_completed_not_run':
            return Status.NotRun;
        default:
            return Status.Unknown;
    }
}

function statusForStage(stage?: PipelineStage): Status {
    if (!stage) {
        return Status.InProgress;
    }
    switch (stage.type) {
        case 'pipeline_state_in_progress_running':
            return Status.InProgress;
        case 'pipeline_step_state_pending_pending':
        case 'pipeline_step_state_in_progress_pending':
            return Status.Pending;
        case 'pipeline_step_state_pending_paused':
        case 'pipeline_state_in_progress_paused':
            return Status.Paused;
        case 'pipeline_step_state_pending_halted':
        case 'pipeline_state_in_progress_halted':
            return Status.Stopped;
        default:
            return Status.Unknown;
    }
}
