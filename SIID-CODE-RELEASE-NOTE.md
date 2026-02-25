## [v2026.0.13]


chore: bump version to 2026.0.13 [skip ci] by @github-actions[bot] in e034d78

fix: update model configurations in MODE_TO_MODELS for improved recommendations by @shivani Thalla in
b7ef188

fix: Remove unnecessary user response flag reset to prevent race conditions by @shivani Thalla in a62c466

feat: Fix follow-up suggestion auto-selection and improve UX - Fixed race condition preventing proper handling of custom input vs suggestion selection - Suggestions now only hide after message sent, not during typing - Selected suggestions show with checkmark and are sent immediately to AI - Prevent context menu auto-selection on @ mentions and / commands by @shivani Thalla in 89044f6
