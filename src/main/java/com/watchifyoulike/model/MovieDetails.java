package com.watchifyoulike.model;

import java.util.List;

/** Everything the movie page needs. */
public record MovieDetails(
        int id,
        String title,
        String tagline,
        String year,
        int runtime,
        double rating,
        int voteCount,
        String overview,
        String posterUrl,
        String backdropUrl,
        List<String> genres,
        String director,
        List<CastMember> cast,
        String trailerKey,
        List<Provider> providers,
        String providerLink,
        String region,
        String type,
        int seasons) {
}
