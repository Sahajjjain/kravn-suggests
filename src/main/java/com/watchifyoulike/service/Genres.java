package com.watchifyoulike.service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** TMDB sends genres as numbers on list endpoints. This turns them into names. */
public final class Genres {

    private static final Map<Integer, String> NAMES = Map.ofEntries(
            Map.entry(28, "Action"),
            Map.entry(12, "Adventure"),
            Map.entry(16, "Animation"),
            Map.entry(35, "Comedy"),
            Map.entry(80, "Crime"),
            Map.entry(99, "Documentary"),
            Map.entry(18, "Drama"),
            Map.entry(10751, "Family"),
            Map.entry(14, "Fantasy"),
            Map.entry(36, "History"),
            Map.entry(27, "Horror"),
            Map.entry(10402, "Music"),
            Map.entry(9648, "Mystery"),
            Map.entry(10749, "Romance"),
            Map.entry(878, "Science Fiction"),
            Map.entry(10770, "TV Movie"),
            Map.entry(53, "Thriller"),
            Map.entry(10752, "War"),
            Map.entry(37, "Western"),
            // genres that only exist for TV series
            Map.entry(10759, "Action & Adventure"),
            Map.entry(10762, "Kids"),
            Map.entry(10763, "News"),
            Map.entry(10764, "Reality"),
            Map.entry(10765, "Sci-Fi & Fantasy"),
            Map.entry(10766, "Soap"),
            Map.entry(10767, "Talk"),
            Map.entry(10768, "War & Politics"));

    private Genres() {
    }

    public static List<String> names(List<Integer> ids) {
        List<String> result = new ArrayList<>();
        for (Integer id : ids) {
            String name = NAMES.get(id);
            if (name != null) {
                result.add(name);
            }
        }
        return result;
    }
}
