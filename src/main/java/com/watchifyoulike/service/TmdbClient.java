package com.watchifyoulike.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.watchifyoulike.exception.ApiException;
import com.watchifyoulike.model.CastMember;
import com.watchifyoulike.model.MovieCard;
import com.watchifyoulike.model.MovieDetails;
import com.watchifyoulike.model.Provider;
import com.watchifyoulike.model.Season;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.net.ConnectException;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.net.UnknownHostException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.StringJoiner;
import java.util.concurrent.ConcurrentHashMap;
import javax.net.ssl.SSLException;

/** Talks to TMDB (The Movie Database) and converts its JSON into our small records. */
@Component
public class TmdbClient {

    private static final Logger log = LoggerFactory.getLogger(TmdbClient.class);
    private static final String BASE = "https://api.themoviedb.org/3";

    /** A saved TMDB answer and the time it stops being fresh. */
    private record Cached(JsonNode body, long expiresAt) {
    }

    private static final long CACHE_MS = 10 * 60 * 1000;

    private final Map<String, Cached> cache = new ConcurrentHashMap<>();
    private final RestClient http;
    private final String token;
    private final boolean useBearer;
    private final String region;

    public TmdbClient(@Value("${tmdb.token:}") String token,
                      @Value("${tmdb.region:IN}") String region) {
        this.token = token.trim().replace("\"", "").replace("'", "").replaceFirst("(?i)^bearer\\s+", "").trim();
        // The long "API Read Access Token" starts with eyJ and goes in a header.
        // The short 32-character "API Key" goes in the URL instead. We support both.
        this.useBearer = this.token.startsWith("eyJ");
        this.region = region;

        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(8000);
        factory.setReadTimeout(15000);
        this.http = RestClient.builder().requestFactory(factory).build();
    }

    // ---------------- public API ----------------

    public List<MovieCard> trending() {
        return cards(get("/trending/movie/week"), "movie");
    }

    /** Home page rows. Only these names are allowed. */
    public List<MovieCard> list(String name) {
        return switch (name) {
            case "trending" -> cards(get("/trending/movie/week"), "movie");
            case "now_playing" -> cards(get("/movie/now_playing", "region", region), "movie");
            case "top_rated" -> cards(get("/movie/top_rated"), "movie");
            case "popular" -> cards(get("/movie/popular"), "movie");
            case "upcoming" -> cards(get("/movie/upcoming", "region", region), "movie");
            case "trending_tv" -> cards(get("/trending/tv/week"), "tv");
            case "on_the_air" -> cards(get("/tv/on_the_air"), "tv");
            case "top_rated_tv" -> cards(get("/tv/top_rated"), "tv");
            case "popular_tv" -> cards(get("/tv/popular"), "tv");
            default -> throw new ApiException(HttpStatus.NOT_FOUND, "Unknown list.");
        };
    }

    /** Searches movies and series together. People and other result types are dropped. */
    public List<MovieCard> search(String query) {
        return cards(get("/search/multi", "query", query, "include_adult", "false"), null);
    }

    /** Browse by genre. sort is "popular" or "rating"; genre 0 means any genre. Pages 1 to 10. */
    public List<MovieCard> discover(String type, int genre, String sort, int page) {
        checkType(type);
        boolean byRating = "rating".equals(sort);
        List<String> params = new ArrayList<>(List.of(
                "include_adult", "false",
                "sort_by", byRating ? "vote_average.desc" : "popularity.desc",
                "vote_count.gte", byRating ? "500" : "50",
                "page", String.valueOf(Math.max(1, Math.min(page, 10)))));
        if (genre > 0) {
            params.add("with_genres");
            params.add(String.valueOf(genre));
        }
        return cards(get("/discover/" + type, params.toArray(new String[0])), type);
    }

    private static String checkType(String type) {
        if (!"movie".equals(type) && !"tv".equals(type)) {
            throw new ApiException(HttpStatus.NOT_FOUND, "That page was not found.");
        }
        return type;
    }

    /** One call that returns the movie or series plus its cast, videos and streaming info. */
    public JsonNode titleRaw(String type, int id) {
        return get("/" + checkType(type) + "/" + id,
                "append_to_response", "credits,videos,watch/providers",
                "include_video_language", "en,hi,null");
    }

    public MovieDetails details(String type, int id) {
        checkType(type);
        boolean tv = "tv".equals(type);
        JsonNode m = titleRaw(type, id);

        List<CastMember> cast = new ArrayList<>();
        for (JsonNode c : m.path("credits").path("cast")) {
            if (cast.size() >= 12) {
                break;
            }
            cast.add(new CastMember(
                    c.path("name").asText(""),
                    c.path("character").asText(""),
                    image("w185", c.path("profile_path"))));
        }

        // Movies show the director, series show the creators.
        List<String> directors = new ArrayList<>();
        if (tv) {
            for (JsonNode c : m.path("created_by")) {
                String name = c.path("name").asText("");
                if (!name.isEmpty()) {
                    directors.add(name);
                }
            }
        } else {
            for (JsonNode c : m.path("credits").path("crew")) {
                if ("Director".equals(c.path("job").asText())) {
                    directors.add(c.path("name").asText(""));
                }
            }
        }

        List<Season> seasons = new ArrayList<>();
        if (tv) {
            for (JsonNode s : m.path("seasons")) {
                if (s.path("season_number").asInt(0) == 0) {
                    continue; // "Specials" are not a real season
                }
                seasons.add(new Season(
                        s.path("name").asText("Season " + s.path("season_number").asInt()),
                        s.path("episode_count").asInt(0),
                        year(s.path("air_date").asText("")),
                        image("w342", s.path("poster_path"))));
            }
        }

        int runtime = 0;
        if (tv) {
            JsonNode runs = m.path("episode_run_time");
            if (runs.isArray() && runs.size() > 0) {
                runtime = runs.get(0).asInt(0);
            }
        } else {
            runtime = m.path("runtime").asInt(0);
        }

        return new MovieDetails(
                m.path("id").asInt(),
                m.path(tv ? "name" : "title").asText(""),
                m.path("tagline").asText(""),
                year(m.path(tv ? "first_air_date" : "release_date").asText("")),
                runtime,
                round1(m.path("vote_average").asDouble(0)),
                m.path("vote_count").asInt(0),
                m.path("overview").asText(""),
                image("w500", m.path("poster_path")),
                image("w1280", m.path("backdrop_path")),
                genreNames(m.path("genres")),
                String.join(", ", directors),
                cast,
                trailerKey(m),
                providers(m),
                m.path("watch/providers").path("results").path(region).path("link").asText(""),
                region,
                type,
                m.path("number_of_seasons").asInt(0),
                m.path("number_of_episodes").asInt(0),
                m.path("status").asText(""),
                seasons);
    }

    /** Candidates = TMDB's "recommendations" first, then "similar" to fill up. Posters only. */
    public List<MovieCard> candidates(String type, int id, int limit) {
        checkType(type);
        Map<Integer, MovieCard> found = new LinkedHashMap<>();
        for (String kind : new String[]{"recommendations", "similar"}) {
            JsonNode results = get("/" + type + "/" + id + "/" + kind).path("results");
            for (JsonNode n : results) {
                int candidateId = n.path("id").asInt();
                if (candidateId == id || found.containsKey(candidateId)) {
                    continue;
                }
                if (!n.path("poster_path").isTextual() || n.path("adult").asBoolean(false)) {
                    continue;
                }
                found.put(candidateId, card(n, type));
                if (found.size() >= limit) {
                    return new ArrayList<>(found.values());
                }
            }
        }
        return new ArrayList<>(found.values());
    }

    // ---------------- helpers ----------------

    public static String year(String releaseDate) {
        return releaseDate.length() >= 4 ? releaseDate.substring(0, 4) : "";
    }

    public List<String> genreNames(JsonNode genres) {
        List<String> names = new ArrayList<>();
        for (JsonNode g : genres) {
            String name = g.path("name").asText("");
            if (!name.isEmpty()) {
                names.add(name);
            }
        }
        return names;
    }

    /**
     * Turns a TMDB result list into cards. forcedType is "movie" or "tv" for lists of one kind;
     * pass null for mixed lists (search), where each result says its own media_type.
     */
    private List<MovieCard> cards(JsonNode root, String forcedType) {
        List<MovieCard> list = new ArrayList<>();
        for (JsonNode n : root.path("results")) {
            if (list.size() >= 20) {
                break;
            }
            String type = forcedType != null ? forcedType : n.path("media_type").asText("");
            if (!"movie".equals(type) && !"tv".equals(type)) {
                continue; // people and anything else
            }
            if (!n.path("title").asText(n.path("name").asText("")).isEmpty()) {
                list.add(card(n, type));
            }
        }
        return list;
    }

    private MovieCard card(JsonNode n, String type) {
        boolean tv = "tv".equals(type);
        List<Integer> genreIds = new ArrayList<>();
        for (JsonNode g : n.path("genre_ids")) {
            genreIds.add(g.asInt());
        }
        return new MovieCard(
                n.path("id").asInt(),
                n.path(tv ? "name" : "title").asText(""),
                year(n.path(tv ? "first_air_date" : "release_date").asText("")),
                image("w342", n.path("poster_path")),
                round1(n.path("vote_average").asDouble(0)),
                n.path("overview").asText(""),
                Genres.names(genreIds),
                image("w780", n.path("backdrop_path")),
                type);
    }

    private String trailerKey(JsonNode m) {
        for (String type : new String[]{"Trailer", "Teaser"}) {
            for (JsonNode v : m.path("videos").path("results")) {
                if ("YouTube".equals(v.path("site").asText()) && type.equals(v.path("type").asText())) {
                    return v.path("key").asText("");
                }
            }
        }
        return "";
    }

    private List<Provider> providers(JsonNode m) {
        JsonNode regionNode = m.path("watch/providers").path("results").path(region);
        String[][] kinds = {
                {"flatrate", "Stream"}, {"free", "Free"}, {"ads", "Free with ads"},
                {"rent", "Rent"}, {"buy", "Buy"}};

        List<Provider> list = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (String[] kind : kinds) {
            for (JsonNode p : regionNode.path(kind[0])) {
                String name = p.path("provider_name").asText("");
                if (!name.isEmpty() && list.size() < 10 && seen.add(name)) {
                    list.add(new Provider(name, image("w92", p.path("logo_path")), kind[1]));
                }
            }
        }
        return list;
    }

    private static String image(String size, JsonNode path) {
        // Served by our own ImageController so users never need to reach TMDB directly.
        return path.isTextual() ? "/img/" + size + path.asText() : null;
    }

    private static double round1(double v) {
        return Math.round(v * 10.0) / 10.0;
    }

    private static String enc(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8);
    }

    /**
     * Sends a GET request. params are key, value, key, value...
     * Answers are cached for 10 minutes, a failed network call is retried once, and if TMDB is
     * down we fall back to the last saved answer so the site keeps working.
     */
    private JsonNode get(String path, String... params) {
        if (token.isEmpty()) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE,
                    "TMDB token is missing. Set TMDB_TOKEN (or tmdb.token in secrets.properties) and restart the app.");
        }

        StringJoiner query = new StringJoiner("&");
        query.add("language=en-US");
        for (int i = 0; i + 1 < params.length; i += 2) {
            query.add(enc(params[i]) + "=" + enc(params[i + 1]));
        }
        String key = path + "?" + query; // the token is not part of the cache key

        Cached saved = cache.get(key);
        if (saved != null && saved.expiresAt() > System.currentTimeMillis()) {
            return saved.body();
        }

        if (!useBearer) {
            query.add("api_key=" + enc(token));
        }
        URI uri = URI.create(BASE + path + "?" + query);

        RestClientException lastError = null;
        for (int attempt = 1; attempt <= 2; attempt++) {
            try {
                JsonNode body = http.get()
                        .uri(uri)
                        .headers(h -> {
                            if (useBearer) {
                                h.setBearerAuth(token);
                            }
                        })
                        .retrieve()
                        .body(JsonNode.class);
                if (body == null) {
                    throw new RestClientException("Empty response from TMDB");
                }
                if (cache.size() > 500) {
                    cache.clear();
                }
                cache.put(key, new Cached(body, System.currentTimeMillis() + CACHE_MS));
                return body;
            } catch (HttpClientErrorException e) {
                int code = e.getStatusCode().value();
                if (code == 401) {
                    throw new ApiException(HttpStatus.BAD_GATEWAY,
                            "TMDB rejected the token. Use the 'API Read Access Token' from your TMDB account settings.");
                }
                if (code == 404) {
                    throw new ApiException(HttpStatus.NOT_FOUND, "That title was not found.");
                }
                throw new ApiException(HttpStatus.BAD_GATEWAY, "TMDB returned an error (" + code + "). Try again.");
            } catch (RestClientException e) {
                lastError = e; // network problem or TMDB hiccup: try once more
            }
        }

        Throwable root = lastError;
        while (root.getCause() != null && root.getCause() != root) {
            root = root.getCause();
        }
        // The real reason is printed in the terminal so problems are easy to diagnose.
        log.warn("TMDB request to {} failed: {} - {}", path, root.getClass().getName(), root.getMessage());
        if (saved != null) {
            return saved.body(); // slightly old data is better than an error page
        }
        throw new ApiException(HttpStatus.BAD_GATEWAY, explain(root));
    }

    private static String explain(Throwable root) {
        String type = root.getClass().getSimpleName();
        if (root instanceof UnknownHostException) {
            return "Your network can't find api.themoviedb.org (a DNS problem). Switch to a mobile hotspot, "
                    + "or set your DNS to 8.8.8.8 or 1.1.1.1, then try again.";
        }
        if (root instanceof SocketTimeoutException || root instanceof ConnectException) {
            return "The connection to TMDB timed out or was refused. Your Wi-Fi or ISP may be blocking TMDB. "
                    + "Try a mobile hotspot or a VPN.";
        }
        if (root instanceof SSLException) {
            return "The secure connection to TMDB failed (" + type + "). An antivirus, proxy or VPN may be "
                    + "interfering. Try turning it off or switching networks.";
        }
        return "Could not reach TMDB (" + type + "). Check your internet connection and try again.";
    }
}
