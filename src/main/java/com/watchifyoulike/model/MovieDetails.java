package com.watchifyoulike.model;

import java.util.List;

/** Everything the movie / series page needs. mediaType is "movie" or "tv". */
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
        String mediaType,
        int seasonCount,
        int episodeCount,
        String status,
        List<Season> seasons) {
}
