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

@RestController
@RequestMapping("/api")
public class MovieController {

    private final TmdbClient tmdb;
    private final MatchService matchService;

    public MovieController(TmdbClient tmdb, MatchService matchService) {
        this.tmdb = tmdb;
        this.matchService = matchService;
    }

    @GetMapping("/trending")
    public List<MovieCard> trending() {
        return tmdb.trending();
    }

    @GetMapping("/lists/{name}")
    public List<MovieCard> list(@PathVariable("name") String name) {
        return tmdb.list(name);
    }

    @GetMapping("/search")
    public List<MovieCard> search(@RequestParam("q") String q) {
        String query = q == null ? "" : q.trim();
        if (query.isEmpty() || query.length() > 100) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Enter a movie name (up to 100 characters).");
        }
        return tmdb.search(query);
    }

    @GetMapping("/movie/{id}")
    public MovieDetails movie(@PathVariable("id") int id) {
        return tmdb.details(id);
    }

    @GetMapping("/movie/{id}/matches")
    public MatchesResponse matches(@PathVariable("id") int id) {
        return matchService.matchesFor(id);
    }
}
