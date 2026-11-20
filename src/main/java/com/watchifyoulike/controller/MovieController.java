package com.watchifyoulike.controller;

import com.watchifyoulike.exception.ApiException;
import com.watchifyoulike.model.MatchesResponse;
import com.watchifyoulike.model.MovieCard;
import com.watchifyoulike.model.MovieDetails;
import com.watchifyoulike.service.MatchService;
import com.watchifyoulike.service.TmdbClient;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** {type} is "movie" or "tv" everywhere below. */
@RestController
@RequestMapping("/api")
public class MovieController {

    private final TmdbClient tmdb;
    private final MatchService matchService;

    public MovieController(TmdbClient tmdb, MatchService matchService) {
        this.tmdb = tmdb;
        this.matchService = matchService;
    }

    @GetMapping("/lists/{type}/{name}")
    public List<MovieCard> list(@PathVariable("type") String type, @PathVariable("name") String name) {
        return tmdb.list(type, name);
    }

    /** type is optional: movie, tv, or all (default) to search both. */
    @GetMapping("/search")
    public List<MovieCard> search(@RequestParam("q") String q,
                                  @RequestParam(value = "type", defaultValue = "all") String type) {
        String query = q == null ? "" : q.trim();
        if (query.isEmpty() || query.length() > 100) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Enter a movie or series name (up to 100 characters).");
        }
        return tmdb.search(type, query);
    }

    @GetMapping("/{type}/{id}")
    public MovieDetails details(@PathVariable("type") String type, @PathVariable("id") int id) {
        TmdbClient.kind(type);
        return tmdb.details(type, id);
    }

    @GetMapping("/{type}/{id}/matches")
    public MatchesResponse matches(@PathVariable("type") String type, @PathVariable("id") int id) {
        TmdbClient.kind(type);
        return matchService.matchesFor(type, id);
    }
}
