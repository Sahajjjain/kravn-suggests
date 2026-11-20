package com.watchifyoulike.model;

/** A recommended movie plus how closely it resembles the searched one (0-100). */
public record Match(MovieCard movie, int similarity, String reason) {
}
