package com.watchifyoulike.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.watchifyoulike.model.Match;
import com.watchifyoulike.model.MatchesResponse;
import com.watchifyoulike.model.MovieCard;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Builds the "Watch if you like..." list:
 * 1) TMDB supplies real candidate movies,  2) Claude scores them,
 * 3) if Claude is unavailable we estimate the score from shared genres.
 */
@Service
public class MatchService {

    private static final int MAX_CANDIDATES = 12;

    private final TmdbClient tmdb;
    private final AiScorer ai;
    private final Map<Integer, MatchesResponse> cache = new ConcurrentHashMap<>();

    public MatchService(TmdbClient tmdb, AiScorer ai) {
        this.tmdb = tmdb;
        this.ai = ai;
    }

    public MatchesResponse matchesFor(int id) {
        MatchesResponse cached = cache.get(id);
        if (cached != null) {
            return cached;
        }

        JsonNode base = tmdb.movieRaw(id);
        String title = base.path("title").asText("this movie");
        String year = TmdbClient.year(base.path("release_date").asText(""));
        String overview = base.path("overview").asText("");
        List<String> baseGenres = tmdb.genreNames(base.path("genres"));
        List<MovieCard> candidates = tmdb.candidates(id, MAX_CANDIDATES);

        Map<Integer, AiScorer.Score> scores = ai.score(title, year, overview, baseGenres, candidates);

        List<Match> matches = new ArrayList<>();
        for (int i = 0; i < candidates.size(); i++) {
            MovieCard candidate = candidates.get(i);
            Match estimate = estimate(title, baseGenres, candidate, i);
            AiScorer.Score score = scores.get(candidate.id());
            if (score == null) {
                matches.add(estimate);
            } else {
                String reason = (score.reason() == null || score.reason().isBlank())
                        ? estimate.reason()
                        : score.reason().trim();
                matches.add(new Match(candidate, clamp(score.similarity()), reason));
            }
        }
        matches.sort(Comparator.comparingInt(Match::similarity).reversed());

        MatchesResponse response = new MatchesResponse(matches, !scores.isEmpty());
        // Don't cache a failed AI attempt, so the next visit can try again.
        if (!ai.isConfigured() || !scores.isEmpty()) {
            if (cache.size() > 300) {
                cache.clear();
            }
            cache.put(id, response);
        }
        return response;
    }

    /** Fallback: more shared genres, higher rating and earlier TMDB rank = higher score. */
    private Match estimate(String baseTitle, List<String> baseGenres, MovieCard candidate, int position) {
        Set<String> shared = new LinkedHashSet<>(candidate.genres());
        shared.retainAll(baseGenres);

        Set<String> all = new HashSet<>(baseGenres);
        all.addAll(candidate.genres());
        double overlap = all.isEmpty() ? 0 : (double) shared.size() / all.size();

        double score = 48 + 38 * overlap + candidate.rating() / 10.0 * 6 + Math.max(0, 8 - position * 0.5);
        int similarity = (int) Math.round(Math.max(35, Math.min(95, score)));

        String reason = shared.isEmpty()
                ? "Often recommended to fans of " + baseTitle + "."
                : "Shares the " + String.join(", ", shared) + " feel of " + baseTitle + ".";
        return new Match(candidate, similarity, reason);
    }

    private static int clamp(int value) {
        return Math.max(0, Math.min(100, value));
    }
}
