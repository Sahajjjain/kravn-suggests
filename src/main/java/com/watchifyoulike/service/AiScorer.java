package com.watchifyoulike.service;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.watchifyoulike.model.MovieCard;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Asks Claude to judge how similar each candidate movie is to the searched movie.
 * If anything goes wrong it returns an empty map and the app falls back to a genre estimate.
 */
@Component
public class AiScorer {

    private static final Logger log = LoggerFactory.getLogger(AiScorer.class);

    /** One AI verdict: which movie, how similar (0-100), and why. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Score(int id, int similarity, String reason) {
    }

    private final RestClient http;
    private final ObjectMapper mapper;
    private final String apiKey;
    private final String model;
    private final int dailyLimit;
    private LocalDate day = LocalDate.now();
    private int usedToday = 0;

    public AiScorer(@Value("${anthropic.api-key:}") String apiKey,
                    @Value("${anthropic.model}") String model,
                    @Value("${anthropic.daily-limit:300}") int dailyLimit,
                    ObjectMapper mapper) {
        this.dailyLimit = dailyLimit;
        this.apiKey = apiKey.trim();
        this.model = model;
        this.mapper = mapper;

        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(5000);
        factory.setReadTimeout(40000);
        this.http = RestClient.builder().requestFactory(factory).build();
    }

    public boolean isConfigured() {
        return !apiKey.isEmpty();
    }

    /** Protects your Anthropic bill: after dailyLimit AI calls in a day, picks are estimated instead. */
    private synchronized boolean allowCall() {
        LocalDate today = LocalDate.now();
        if (!today.equals(day)) {
            day = today;
            usedToday = 0;
        }
        if (usedToday >= dailyLimit) {
            return false;
        }
        usedToday++;
        return true;
    }

    public Map<Integer, Score> score(String kind, String title, String year, String overview,
                                     List<String> genres, List<MovieCard> candidates) {
        if (!isConfigured() || candidates.isEmpty() || !allowCall()) {
            return Map.of();
        }
        try {
            List<Map<String, Object>> compact = new ArrayList<>();
            for (MovieCard c : candidates) {
                String text = c.overview() == null ? "" : c.overview();
                if (text.length() > 240) {
                    text = text.substring(0, 240) + "...";
                }
                compact.add(Map.of(
                        "id", c.id(),
                        "title", c.title(),
                        "year", c.year(),
                        "genres", c.genres(),
                        "overview", text));
            }

            String prompt = """
                    A viewer loves the %s "%s" (%s).
                    Genres: %s
                    Plot: %s

                    Here are candidate titles to recommend, as JSON:
                    %s

                    For EVERY candidate give a "similarity" from 0 to 100: how close it is to the
                    loved title in themes, tone, pacing, storytelling style and emotional feel.
                    Be honest and spread the scores out. Reserve 85 and above for movies that are
                    truly near-twins, and give loosely related picks scores in the 40s and 50s.
                    Write a "reason": one short sentence (max 18 words) on why a fan of the loved
                    title would enjoy it. No spoilers.

                    Reply with ONLY a JSON array, no markdown and no other text:
                    [{"id": 123, "similarity": 87, "reason": "..."}]
                    """.formatted(kind, title, year, String.join(", ", genres), overview,
                    mapper.writeValueAsString(compact));

            Map<String, Object> body = Map.of(
                    "model", model,
                    "max_tokens", 2000,
                    "messages", List.of(Map.of("role", "user", "content", prompt)));

            JsonNode reply = http.post()
                    .uri("https://api.anthropic.com/v1/messages")
                    .headers(h -> {
                        h.set("x-api-key", apiKey);
                        h.set("anthropic-version", "2023-06-01");
                    })
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body)
                    .retrieve()
                    .body(JsonNode.class);

            String text = reply.path("content").path(0).path("text").asText("");
            int start = text.indexOf('[');
            int end = text.lastIndexOf(']');
            if (start < 0 || end <= start) {
                return Map.of();
            }

            Score[] scores = mapper.readValue(text.substring(start, end + 1), Score[].class);
            Map<Integer, Score> byId = new HashMap<>();
            for (Score s : scores) {
                byId.put(s.id(), s);
            }
            return byId;
        } catch (Exception e) {
            log.warn("AI scoring failed, using genre estimate instead: {}", e.getMessage());
            return Map.of();
        }
    }
}
