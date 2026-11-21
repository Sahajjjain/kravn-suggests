package com.watchifyoulike.controller;

import com.watchifyoulike.exception.ApiException;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClient;

import java.net.URI;
import java.time.Duration;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Posters and photos are fetched from TMDB's image server by OUR server and passed on.
 * That way a visitor whose network blocks image.tmdb.org still sees every picture,
 * and the browser caches each image for 30 days.
 */
@RestController
public class ImageController {

    private static final Set<String> SIZES = Set.of("w92", "w185", "w342", "w500", "w780", "w1280");
    private static final Pattern FILE = Pattern.compile("[A-Za-z0-9_-]{5,60}\\.(jpg|jpeg|png)");

    private final RestClient http;

    public ImageController() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(5000);
        factory.setReadTimeout(15000);
        this.http = RestClient.builder().requestFactory(factory).build();
    }

    @GetMapping("/img/{size}/{file}")
    public ResponseEntity<byte[]> image(@PathVariable("size") String size, @PathVariable("file") String file) {
        // Only known sizes and plain file names are allowed, so this can't be used to fetch other URLs.
        if (!SIZES.contains(size) || !FILE.matcher(file).matches()) {
            throw new ApiException(HttpStatus.NOT_FOUND, "Image not found.");
        }
        try {
            ResponseEntity<byte[]> upstream = http.get()
                    .uri(URI.create("https://image.tmdb.org/t/p/" + size + "/" + file))
                    .retrieve()
                    .toEntity(byte[].class);
            MediaType type = upstream.getHeaders().getContentType() != null
                    ? upstream.getHeaders().getContentType()
                    : MediaType.IMAGE_JPEG;
            return ResponseEntity.ok()
                    .contentType(type)
                    .cacheControl(CacheControl.maxAge(Duration.ofDays(30)).cachePublic())
                    .body(upstream.getBody() == null ? new byte[0] : upstream.getBody());
        } catch (Exception e) {
            throw new ApiException(HttpStatus.NOT_FOUND, "Image unavailable.");
        }
    }
}
