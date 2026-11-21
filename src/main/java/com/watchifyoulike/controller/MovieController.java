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

    @GetMapping("/discover/movie")
    public List<MovieCard> discoverMovies(@RequestParam(name = "genre", defaultValue = "0") int genre,
                                          @RequestParam(name = "sort", defaultValue = "popular") String sort,
                                          @RequestParam(name = "page", defaultValue = "1") int page) {
        return tmdb.discover("movie", genre, sort, page);
    }

    @GetMapping("/discover/tv")
    public List<MovieCard> discoverSeries(@RequestParam(name = "genre", defaultValue = "0") int genre,
                                          @RequestParam(name = "sort", defaultValue = "popular") String sort,
                                          @RequestParam(name = "page", defaultValue = "1") int page) {
        return tmdb.discover("tv", genre, sort, page);
    }

    @GetMapping("/search")
    public List<MovieCard> search(@RequestParam("q") String q) {
        String query = q == null ? "" : q.trim();
        if (query.isEmpty() || query.length() > 100) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Enter a movie or series name (up to 100 characters).");
        }
        return tmdb.search(query);
    }

    @GetMapping("/movie/{id}")
    public MovieDetails movie(@PathVariable("id") int id) {
        return tmdb.details("movie", id);
    }

    @GetMapping("/tv/{id}")
    public MovieDetails series(@PathVariable("id") int id) {
        return tmdb.details("tv", id);
    }

    @GetMapping("/movie/{id}/matches")
    public MatchesResponse movieMatches(@PathVariable("id") int id) {
        return matchService.matchesFor("movie", id);
    }

    @GetMapping("/tv/{id}/matches")
    public MatchesResponse seriesMatches(@PathVariable("id") int id) {
        return matchService.matchesFor("tv", id);
    }
}
