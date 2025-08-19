import { Comment, FileDiff, Task } from '../../bitbucket/model';

export function addToCommentHierarchy(comments: Comment[], commentToAdd: Comment): [Comment[], boolean] {
    for (const comment of comments) {
        if (comment.id === commentToAdd.parentId) {
            return [
                [
                    ...comments.map((c) => {
                        return c.id === comment.id ? { ...comment, children: [...comment.children, commentToAdd] } : c;
                    }),
                ],
                true,
            ];
        } else {
            const [children, success] = addToCommentHierarchy(comment.children, commentToAdd);
            if (success) {
                return [
                    [
                        ...comments.map((c) => {
                            return c.id === comment.id ? { ...comment, children: children } : c;
                        }),
                    ],
                    success,
                ];
            }
        }
    }
    return [comments.slice(), false];
}

export function replaceCommentInHierarchy(comments: Comment[], updatedComment: Comment): [Comment[], boolean] {
    for (const comment of comments) {
        if (comment.id === updatedComment.id) {
            return [
                //When the API returns a comment for the edit comment endpoint, it does not contain children or tasks (these are properties we maintain)
                //Therefore, we must be careful to carry over these properties. Note that it is not sufficient generalize with ...c, ...updatedComment,
                //because these properties are defined but empty in updatedComment, so they will be overwritten as empty.
                comments.map((c) =>
                    c.id === updatedComment.id ? { ...updatedComment, children: c.children, tasks: c.tasks } : c,
                ),
                true,
            ];
        } else {
            const [children, success] = replaceCommentInHierarchy(comment.children, updatedComment);
            if (success) {
                return [
                    [
                        ...comments.map((c) => {
                            return c.id === comment.id ? { ...comment, children: children } : c;
                        }),
                    ],
                    success,
                ];
            }
        }
    }
    return [comments.slice(), false];
}

export function addTaskToCommentHierarchy(comments: Comment[], task: Task): [Comment[], boolean] {
    for (const comment of comments) {
        if (comment.id === task.commentId) {
            return [
                comments.map((c: Comment) => {
                    return c.id === comment.id ? { ...comment, tasks: [...comment.tasks, task] } : c;
                }),
                true,
            ];
        } else {
            const [children, success] = addTaskToCommentHierarchy(comment.children, task);
            if (success) {
                return [
                    [
                        ...comments.map((c) => {
                            return c.id === comment.id ? { ...comment, children: children } : c;
                        }),
                    ],
                    success,
                ];
            }
        }
    }
    return [comments.slice(), false];
}

export function addTasksToCommentHierarchy(comments: Comment[], tasks: Task[]): Comment[] {
    let updatedComments = comments;
    for (const task of tasks) {
        if (task.commentId) {
            [updatedComments] = addTaskToCommentHierarchy(updatedComments, task);
        }
    }

    return updatedComments;
}

export function replaceTaskInTaskList(tasks: Task[], task: Task) {
    return tasks.map((t) => (t.id === task.id ? task : t));
}

export function replaceTaskInCommentHierarchy(comments: Comment[], task: Task): [Comment[], boolean] {
    for (const comment of comments) {
        if (comment.id === task.commentId) {
            return [
                comments.map((c: Comment) => {
                    return c.id === comment.id ? { ...comment, tasks: replaceTaskInTaskList(comment.tasks, task) } : c;
                }),
                true,
            ];
        } else {
            const [children, success] = replaceTaskInCommentHierarchy(comment.children, task);
            if (success) {
                return [
                    [
                        ...comments.map((c) => {
                            return c.id === comment.id ? { ...comment, children: children } : c;
                        }),
                    ],
                    success,
                ];
            }
        }
    }
    return [comments.slice(), false];
}

export function fileDiffContainsComments(fileDiff: FileDiff, inlineComments: Comment[]) {
    for (const comment of inlineComments) {
        if (fileDiff.oldPath && comment.inline?.path === fileDiff.oldPath) {
            return true;
        }
        if (fileDiff.newPath && comment.inline?.path === fileDiff.newPath) {
            return true;
        }
    }
    return false;
}
