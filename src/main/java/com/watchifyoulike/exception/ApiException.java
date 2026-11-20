package com.watchifyoulike.exception;

import org.springframework.http.HttpStatus;

/** An error we want the browser to see as a friendly message. */
public class ApiException extends RuntimeException {

    private final HttpStatus status;

    public ApiException(HttpStatus status, String message) {
        super(message);
        this.status = status;
    }

    public HttpStatus getStatus() {
        return status;
    }
}
