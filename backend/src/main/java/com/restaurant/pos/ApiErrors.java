package com.restaurant.pos;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import java.util.LinkedHashMap;
import java.util.Map;
import com.fasterxml.jackson.databind.JsonMappingException;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

@RestControllerAdvice
public class ApiErrors {
    private static final Logger LOG = LoggerFactory.getLogger(ApiErrors.class);
    public static Map<String, Object> body(int status, String message, HttpServletRequest request) {
        Object id = request.getAttribute("requestId");
        if (id == null) { id = UUID.randomUUID().toString(); request.setAttribute("requestId", id); }
        String code = switch (status) {
            case 400 -> "BAD_REQUEST"; case 401 -> "UNAUTHENTICATED"; case 403 -> "FORBIDDEN";
            case 404 -> "NOT_FOUND"; case 405 -> "METHOD_NOT_ALLOWED"; case 409 -> "CONFLICT"; case 413 -> "PAYLOAD_TOO_LARGE";
            case 415 -> "UNSUPPORTED_MEDIA_TYPE"; case 422 -> "VALIDATION_FAILED";
            case 429 -> "RATE_LIMITED"; case 503 -> "UNAVAILABLE"; default -> "INTERNAL_ERROR";
        };
        return Map.of("code", code, "message", message, "requestId", id.toString());
    }
    @ExceptionHandler(ApiException.class)
    ResponseEntity<?> api(ApiException ex, HttpServletRequest request) {
        var response = new LinkedHashMap<>(body(ex.status(), ex.getMessage(), request));
        if (!ex.fieldErrors().isEmpty()) response.put("fieldErrors", ex.fieldErrors());
        return ResponseEntity.status(ex.status()).body(response);
    }
    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<?> fields(MethodArgumentNotValidException ex, HttpServletRequest request) {
        Map<String, String> issues = new LinkedHashMap<>();
        ex.getBindingResult().getFieldErrors().forEach(field ->
                issues.putIfAbsent(field.getField(), field.getDefaultMessage() == null ? "Enter a valid value." : field.getDefaultMessage()));
        return validation(issues, request);
    }
    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<?> unreadable(HttpMessageNotReadableException ex, HttpServletRequest request) {
        if (ex.getCause() instanceof JsonMappingException mapping) {
            StringBuilder path = new StringBuilder();
            for (var reference : mapping.getPath()) {
                String name = reference.getFieldName();
                if (name != null && name.matches("[A-Za-z][A-Za-z0-9_]{0,63}")) {
                    if (!path.isEmpty()) path.append('.');
                    path.append(name);
                } else if (reference.getIndex() >= 0) {
                    path.append('[').append(reference.getIndex()).append(']');
                }
            }
            if (!path.isEmpty()) return validation(Map.of(path.toString(), "Use the expected format or select a valid option."), request);
        }
        return ResponseEntity.badRequest().body(body(400, "The request could not be read. Check the form and submit it again.", request));
    }
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    ResponseEntity<?> mismatch(MethodArgumentTypeMismatchException ex, HttpServletRequest request) {
        return validation(Map.of(ex.getName(), "Use a valid value for this field."), request);
    }
    private ResponseEntity<?> validation(Map<String, String> issues, HttpServletRequest request) {
        var response = new LinkedHashMap<>(body(400, "Check the highlighted fields and try again.", request));
        response.put("fieldErrors", issues);
        return ResponseEntity.badRequest().body(response);
    }
    @ExceptionHandler({ConstraintViolationException.class,

            org.springframework.web.bind.MissingServletRequestParameterException.class,
            org.springframework.web.method.annotation.HandlerMethodValidationException.class,
            IllegalArgumentException.class})
    ResponseEntity<?> invalid(Exception ex, HttpServletRequest request) {
        // Never include rejected values: they may contain credentials or another tenant's identifiers.
        return ResponseEntity.badRequest().body(body(400, "Check the required information and try again.", request));
    }
    @ExceptionHandler(DataIntegrityViolationException.class)
    ResponseEntity<?> conflict(DataIntegrityViolationException ex, HttpServletRequest request) {
        return ResponseEntity.status(409).body(body(409, "This change conflicts with an existing record or its dependencies.", request));
    }
    @ExceptionHandler(org.springframework.web.HttpRequestMethodNotSupportedException.class)
    ResponseEntity<?> method(Exception ex, HttpServletRequest request) {
        return ResponseEntity.status(405).body(body(405, "This method is not supported for this endpoint.", request));
    }
    @ExceptionHandler(org.springframework.web.HttpMediaTypeNotSupportedException.class)
    ResponseEntity<?> media(Exception ex, HttpServletRequest request) {
        return ResponseEntity.status(415).body(body(415, "Use application/json for API writes.", request));
    }
    @ExceptionHandler(org.springframework.dao.ConcurrencyFailureException.class)
    ResponseEntity<?> concurrency(Exception ex, HttpServletRequest request) {
        return ResponseEntity.status(409).body(body(409, "A concurrent change interrupted this operation. Refresh and retry.", request));
    }
    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<?> missing(Exception ex, HttpServletRequest request) {
        return ResponseEntity.status(404).body(body(404, "Resource not found.", request));
    }
    @ExceptionHandler(DataAccessException.class)
    ResponseEntity<?> database(DataAccessException ex, HttpServletRequest request) {
        // Driver messages may include SQL parameters; do not log them.
        LOG.error("Database operation failed; requestId={}, category={}", request.getAttribute("requestId"), ex.getClass().getSimpleName());
        return ResponseEntity.status(500).body(body(500, "The operation could not be completed.", request));
    }
    @ExceptionHandler(Exception.class)
    ResponseEntity<?> unexpected(Exception ex, HttpServletRequest request) {
        LOG.error("Request failed; requestId={}, category={}", request.getAttribute("requestId"), ex.getClass().getSimpleName());
        return ResponseEntity.status(500).body(body(500, "The operation could not be completed.", request));
    }
}
