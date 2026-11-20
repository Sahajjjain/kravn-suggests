package com.watchifyoulike.model;

/** A place to watch the movie. type is Stream, Free, Free with ads, Rent or Buy. */
public record Provider(String name, String logoUrl, String type) {
}
