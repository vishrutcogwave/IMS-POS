package com.restaurant.pos;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URI;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

public final class SessionFilter extends OncePerRequestFilter {
    private static final Set<String> SAFE = Set.of("GET", "HEAD", "OPTIONS");
    private final AuthService auth;
    private final ObjectMapper mapper;
    private final String origin;
    private final PrintDeviceController devices;
    public SessionFilter(AuthService auth, ObjectMapper mapper, String origin) { this(auth, mapper, origin, null); }
    public SessionFilter(AuthService auth, ObjectMapper mapper, String origin, PrintDeviceController devices) {
        this.auth = auth; this.mapper = mapper; this.origin = canonicalOrigin(origin); this.devices = devices;
    }
    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        request.setAttribute("requestId", UUID.randomUUID().toString());
        response.setHeader("X-Request-Id", request.getAttribute("requestId").toString());
        if (request.getRequestURI().startsWith("/api/")) response.setHeader("Cache-Control", "no-store");
        try {
            boolean write = !SAFE.contains(request.getMethod());
            if (write) {
                sameOrigin(request);
                if (request.getContentLengthLong() > 1_048_576) throw new ApiException(413, "Request body is too large.");
                String type = request.getContentType();
                try {
                    if (type == null || !MediaType.APPLICATION_JSON.isCompatibleWith(MediaType.parseMediaType(type))) {
                        throw new ApiException(415, "Use application/json for API writes.");
                    }
                } catch (org.springframework.http.InvalidMediaTypeException ex) {
                    throw new ApiException(415, "Use application/json for API writes.");
                }
            }
            String path = request.getRequestURI();
            boolean publicAuth = "POST".equals(request.getMethod())
                    && (path.equals("/api/auth/login") || path.equals("/api/auth/onboard"));
            boolean printDevice = "POST".equals(request.getMethod()) && Set.of("/api/print-device/pair",
                    "/api/print-device/claim", "/api/print-device/start", "/api/print-device/result").contains(path);
            if (printDevice) {
                if (devices == null) throw new ApiException(401,"Print device authentication is unavailable.");
                UUID pc = devices.authenticate(request.getHeader("Authorization"),path.endsWith("/pair"));
                SecurityContextHolder.getContext().setAuthentication(
                        new UsernamePasswordAuthenticationToken(pc,null,List.of()));
            } else if (!publicAuth && path.startsWith("/api/") && !path.startsWith("/api/platform/")) {
                String token = cookie(request);
                AuthService.Session session = auth.resolve(token);
                if (session == null) throw new ApiException(401, "Your session has expired. Sign in again.");
                if (write && !AuthService.constantTime(session.csrfToken(), request.getHeader("X-CSRF-Token"))) {
                    throw new ApiException(403, "Invalid CSRF token. Refresh your session.");
                }
                request.setAttribute("csrfToken", session.csrfToken());
                request.setAttribute("sessionHash", session.tokenHash());
                SecurityContextHolder.getContext().setAuthentication(
                        new UsernamePasswordAuthenticationToken(session.actor(), null, List.of()));
            }
            chain.doFilter(request, response);
        } catch (ApiException ex) {
            response.setStatus(ex.status()); response.setContentType("application/json");
            mapper.writeValue(response.getOutputStream(), ApiErrors.body(ex.status(), ex.getMessage(), request));
        } catch (org.springframework.dao.DataAccessException ex) {
            response.setStatus(503); response.setContentType("application/json");
            mapper.writeValue(response.getOutputStream(), ApiErrors.body(503, "Service temporarily unavailable.", request));
        } finally { SecurityContextHolder.clearContext(); }
    }
    private String cookie(HttpServletRequest request) {
        String token = null;
        if (request.getCookies() != null) for (Cookie cookie : request.getCookies()) {
            if (AuthService.COOKIE.equals(cookie.getName())) {
                if (token != null) throw new ApiException(401, "Invalid session.");
                token = cookie.getValue();
            }
        }
        return token;
    }
    void sameOrigin(HttpServletRequest request) {
        if ("cross-site".equalsIgnoreCase(request.getHeader("Sec-Fetch-Site"))) throw new ApiException(403, "Cross-origin writes are not allowed.");
        String supplied = request.getHeader("Origin");
        if (supplied == null) supplied = request.getHeader("Referer");
        if (supplied != null) {
            try {
                if (!origin.equals(canonicalOrigin(supplied))) throw new ApiException(403, "Cross-origin writes are not allowed.");
            } catch (IllegalArgumentException ex) { throw new ApiException(403, "Cross-origin writes are not allowed."); }
        }
        // Non-browser clients may omit Origin. Browser writes still require JSON and session CSRF.
    }
    static String canonicalOrigin(String value) {
        URI uri = URI.create(value);
        if (uri.getHost() == null || uri.getUserInfo() != null
                || !("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))) {
            throw new IllegalArgumentException("APP_ORIGIN must be an HTTP(S) origin.");
        }
        int port = uri.getPort() < 0 ? ("https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80) : uri.getPort();
        String host = uri.getHost().toLowerCase(java.util.Locale.ROOT);
        // Vite may be opened as either localhost or 127.0.0.1 on local development machines.
        if ("127.0.0.1".equals(host)) host = "localhost";
        return uri.getScheme().toLowerCase(java.util.Locale.ROOT) + "://" + host + ":" + port;
    }
}
