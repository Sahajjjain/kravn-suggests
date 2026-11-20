package com.watchifyoulike;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class WatchIfYouLikeApplication {
    public static void main(String[] args) {
        // Some networks have broken IPv6 routes to TMDB. Prefer IPv4 to avoid random timeouts.
        System.setProperty("java.net.preferIPv4Stack", "true");
        SpringApplication.run(WatchIfYouLikeApplication.class, args);
    }
}
