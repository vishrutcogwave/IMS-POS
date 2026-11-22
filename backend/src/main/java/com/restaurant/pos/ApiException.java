package com.restaurant.pos;

public class ApiException extends RuntimeException {
    private final int status;
    private final java.util.Map<String, String> fieldErrors;
    public ApiException(int status, String message) { this(status, message, java.util.Map.of()); }
    public ApiException(int status, String message, java.util.Map<String, String> fieldErrors) {
        super(message);
        this.status = status;
        this.fieldErrors = java.util.Map.copyOf(fieldErrors);
    }
    public java.util.Map<String, String> fieldErrors() { return fieldErrors; }
    public int status() { return status; }
    public int getStatus() { return status; }
}
