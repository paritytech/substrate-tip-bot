/*
OpenGov has to have tip values configured at the time of proposal,
in contrast to gov1 (treasury) in which the tip value is determined after proposal.

Here we hardcode the values for "small", "medium" and "large" tips
in order to be consistent with the current gov1 (treasury) tip sizes,
but based on feedback it could be changed to either:
- "/tip small" and "/tip big", because there are 2 tracks - "Small Tipper" and "Big Tipper"
- Configurable amount, e.g. "/tip 5" instead of "/tip small"
 */

export const OPENGOV_SMALL_TIP_VALUE = 5_000_000_000_000; // 5 units
export const OPENGOV_MEDIUM_TIP_VALUE = 10_000_000_000_000; // 10 units
export const OPENGOV_LARGE_TIP_VALUE = 20_000_000_000_000; // 20 units
