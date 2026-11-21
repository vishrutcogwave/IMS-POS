package com.restaurant.pos;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final AuthService auth;
    public AuthController(AuthService auth) { this.auth = auth; }
    @PostMapping("/login")
    public Map<String, Object> login(@Valid @RequestBody AuthDtos.Login input, HttpServletRequest request, HttpServletResponse response) {
        AuthService.LoginResult result = auth.login(input, request.getRemoteAddr());
        response.addHeader(HttpHeaders.SET_COOKIE, result.cookie());
        return result.body();
    }
    @GetMapping("/me")
    public Map<String, Object> me(HttpServletRequest request) {
        return auth.envelope(Actor.current(), (String) request.getAttribute("csrfToken"));
    }
    @PostMapping("/logout")
    public Map<String, Object> logout(HttpServletRequest request, HttpServletResponse response) {
        auth.logout(Actor.current(), (String) request.getAttribute("sessionHash"));
        response.addHeader(HttpHeaders.SET_COOKIE, auth.clearCookie());
        return Map.of("ok", true);
    }
    @PatchMapping("/profile")
    public Map<String, Object> profile(@Valid @RequestBody AuthDtos.Profile input) {
        auth.profile(Actor.current(), input); return Map.of("ok", true);
    }
    @PostMapping("/password")
    public Map<String, Object> password(@Valid @RequestBody AuthDtos.Password input, HttpServletResponse response) {
        auth.password(Actor.current(), input);
        response.addHeader(HttpHeaders.SET_COOKIE, auth.clearCookie());
        return Map.of("ok", true);
    }
    @PostMapping("/onboard")
    public Map<String, Object> onboard(@Valid @RequestBody AuthDtos.Onboard input,
            @RequestHeader(value="X-Onboarding-Key", required=false) String key, HttpServletRequest request) {
        return auth.onboard(input, key, request.getRemoteAddr());
    }
}
