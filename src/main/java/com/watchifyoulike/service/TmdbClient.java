package com.watchifyoulike.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.watchifyoulike.exception.ApiException;
import com.watchifyoulike.model.CastMember;
import com.watchifyoulike.model.MovieCard;
import com.watchifyoulike.model.MovieDetails;
import com.watchifyoulike.model.Provider;
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
import javax.net.ssl.SSLException;

/** Talks to TMDB (The Movie Database) and converts its JSON into our small records. */
@Component
public class TmdbClient {

    private static final Logger log = LoggerFactory.getLogger(TmdbClient.class);
    private static final String BASE = "https://api.themoviedb.org/3";
    private static final String IMAGES = "https://image.tmdb.org/t/p/";

    private final RestClient http;
    private final String token;
    private final boolean useBearer;
    private final String region;

    public TmdbClient(@Value("${tmdb.token:}") String token,
                      @Value("${tmdb.region:IN}") String region) {
        this.token = token.trim();
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

    /** "movie" or "tv". Anything else is rejected. */
    public static String kind(String type) {
        if ("movie".equals(type) || "tv".equals(type)) {
            return type;
        }
        throw new ApiException(HttpStatus.NOT_FOUND, "Unknown type. Use movie or tv.");
    }

    /** Home page rows. Only these names are allowed. */
    public List<MovieCard> list(String type, String name) {
        kind(type);
        boolean tv = "tv".equals(type);
        return switch (name) {
            case "trending" -> cards(get("/trending/" + type + "/week"), type);
            case "now_playing" -> tv
                    ? cards(get("/tv/on_the_air"), type)
                    : cards(get("/movie/now_playing", "region", region), type);
            case "top_rated" -> cards(get("/" + type + "/top_rated"), type);
            default -> throw new ApiException(HttpStatus.NOT_FOUND, "Unknown list.");
        };
    }

    /** type = movie, tv, or anything else (e.g. "all") to search both at once. */
    public List<MovieCard> search(String type, String query) {
        if ("movie".equals(type) || "tv".equals(type)) {
            return cards(get("/search/" + type, "query", query, "include_adult", "false"), type);
        }
        return cards(get("/search/multi", "query", query, "include_adult", "false"), null);
    }

    /** One call that returns the title plus its cast, videos and streaming info. */
    public JsonNode raw(String type, int id) {
        return get("/" + kind(type) + "/" + id,
                "append_to_response", "credits,videos,watch/providers",
                "include_video_language", "en,hi,null");
    }

    public static String titleOf(JsonNode n) {
        String t = n.path("title").asText("");
        return t.isEmpty() ? n.path("name").asText("") : t;
    }

    public static String dateOf(JsonNode n) {
        String d = n.path("release_date").asText("");
        return d.isEmpty() ? n.path("first_air_date").asText("") : d;
    }

    public MovieDetails details(String type, int id) {
        JsonNode m = raw(type, id);
        boolean tv = "tv".equals(type);

        List<CastMember> cast = new ArrayList<>();
        for (JsonNode c : m.path("credits").path("cast")) {
            if (cast.size() >= 12) {
                break;
            }
            String role = c.path("character").asText("");
            if (role.isEmpty() && c.path("roles").isArray() && c.path("roles").size() > 0) {
                role = c.path("roles").get(0).path("character").asText("");
            }
            cast.add(new CastMember(
                    c.path("name").asText(""),
                    role,
                    image("w185", c.path("profile_path"))));
        }

        // Movies have a director; series have creators.
        List<String> directors = new ArrayList<>();
        if (tv) {
            for (JsonNode c : m.path("created_by")) {
                directors.add(c.path("name").asText(""));
            }
        } else {
            for (JsonNode c : m.path("credits").path("crew")) {
                if ("Director".equals(c.path("job").asText())) {
                    directors.add(c.path("name").asText(""));
                }
            }
        }

        int runtime = tv
                ? (m.path("episode_run_time").size() > 0 ? m.path("episode_run_time").get(0).asInt(0) : 0)
                : m.path("runtime").asInt(0);

        return new MovieDetails(
                m.path("id").asInt(),
                titleOf(m),
                m.path("tagline").asText(""),
                year(dateOf(m)),
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
                m.path("number_of_seasons").asInt(0));
    }

    /** Candidates = TMDB's "recommendations" first, then "similar" to fill up. Posters only. */
    public List<MovieCard> candidates(String type, int id, int limit) {
        Map<Integer, MovieCard> found = new LinkedHashMap<>();
        for (String kind : new String[]{"recommendations", "similar"}) {
            JsonNode results = get("/" + kind(type) + "/" + id + "/" + kind).path("results");
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

    /** type null = take it from each result's media_type (multi search). */
    private List<MovieCard> cards(JsonNode root, String type) {
        List<MovieCard> list = new ArrayList<>();
        for (JsonNode n : root.path("results")) {
            if (list.size() >= 20) {
                break;
            }
            String t = type != null ? type : n.path("media_type").asText("");
            if (!"movie".equals(t) && !"tv".equals(t)) {
                continue; // people etc. from multi search
            }
            if (!titleOf(n).isEmpty()) {
                list.add(card(n, t));
            }
        }
        return list;
    }

    private MovieCard card(JsonNode n, String type) {
        List<Integer> genreIds = new ArrayList<>();
        for (JsonNode g : n.path("genre_ids")) {
            genreIds.add(g.asInt());
        }
        return new MovieCard(
                n.path("id").asInt(),
                titleOf(n),
                year(dateOf(n)),
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
        return path.isTextual() ? IMAGES + size + path.asText() : null;
    }

    private static double round1(double v) {
        return Math.round(v * 10.0) / 10.0;
    }

    private static String enc(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8);
    }

    /** Sends a GET request. params are key, value, key, value... */
    private JsonNode get(String path, String... params) {
        if (token.isEmpty()) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE,
                    "TMDB token is missing. Put it in secrets.properties (tmdb.token=...) and restart the app.");
        }

        StringJoiner query = new StringJoiner("&");
        query.add("language=en-US");
        for (int i = 0; i + 1 < params.length; i += 2) {
            query.add(enc(params[i]) + "=" + enc(params[i + 1]));
        }
        if (!useBearer) {
            query.add("api_key=" + enc(token));
        }
        URI uri = URI.create(BASE + path + "?" + query);

        try {
            return http.get()
                    .uri(uri)
                    .headers(h -> {
                        if (useBearer) {
                            h.setBearerAuth(token);
                        }
                    })
                    .retrieve()
                    .body(JsonNode.class);
        } catch (HttpClientErrorException e) {
            int code = e.getStatusCode().value();
            if (code == 401) {
                throw new ApiException(HttpStatus.BAD_GATEWAY,
                        "TMDB rejected your token. Copy the 'API Read Access Token' from your TMDB account settings.");
            }
            if (code == 404) {
                throw new ApiException(HttpStatus.NOT_FOUND, "That title was not found.");
            }
            throw new ApiException(HttpStatus.BAD_GATEWAY, "TMDB returned an error (" + code + "). Try again.");
        } catch (RestClientException e) {
            Throwable root = e;
            while (root.getCause() != null && root.getCause() != root) {
                root = root.getCause();
            }
            // The real reason is printed in the terminal so problems are easy to diagnose.
            log.warn("TMDB request to {} failed: {} - {}", path, root.getClass().getName(), root.getMessage());
            throw new ApiException(HttpStatus.BAD_GATEWAY, explain(root));
        }
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
