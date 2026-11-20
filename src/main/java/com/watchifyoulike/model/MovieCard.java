package com.watchifyoulike.model;

import java.util.List;

/** The small version of a movie used in grids and search results. */
public record MovieCard(
        int id,
        String title,
        String year,
        String posterUrl,
        double rating,
        String overview,
        List<String> genres,
        String backdropUrl,
        String type) {
}
