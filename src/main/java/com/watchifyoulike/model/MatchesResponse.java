package com.watchifyoulike.model;

import java.util.List;

/** aiScored is true when Claude produced the percentages, false when they were estimated from genres. */
public record MatchesResponse(List<Match> matches, boolean aiScored) {
}
