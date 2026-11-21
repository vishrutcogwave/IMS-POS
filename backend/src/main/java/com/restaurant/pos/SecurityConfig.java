package com.restaurant.pos;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter;

@Configuration
public class SecurityConfig {
    @Bean PasswordEncoder passwordEncoder() { return new BCryptPasswordEncoder(12); }
    @Bean
    SecurityFilterChain security(HttpSecurity http, AuthService auth, ObjectMapper mapper,
            @Value("${app.origin}") String origin, @Value("${app.api-docs-enabled:false}") boolean docs) throws Exception {
        http.csrf(csrf -> csrf.disable()) // Opaque-session CSRF is checked by SessionFilter, including logout.
            .cors(cors -> cors.disable())
            .formLogin(form -> form.disable()).httpBasic(basic -> basic.disable()).logout(logout -> logout.disable())
            .requestCache(cache -> cache.disable())
            .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .headers(headers -> headers
                    .contentSecurityPolicy(csp -> csp.policyDirectives(docs
                            ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'"
                            : "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"))
                    .frameOptions(frame -> frame.deny())
                    .referrerPolicy(referrer -> referrer.policy(org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter.ReferrerPolicy.NO_REFERRER))
                    .permissionsPolicyHeader(policy -> policy.policy("camera=(), microphone=(), geolocation=()")))
            .authorizeHttpRequests(access -> {
                access.requestMatchers(HttpMethod.POST, "/api/auth/login", "/api/auth/onboard").permitAll();
                if (docs) access.requestMatchers("/v3/api-docs/**", "/swagger-ui/**", "/swagger-ui.html").permitAll();
                access.requestMatchers("/api/**").authenticated().anyRequest().denyAll();
            })
            .exceptionHandling(errors -> errors
                .authenticationEntryPoint((request, response, ex) -> {
                    response.setStatus(401); response.setContentType("application/json");
                    mapper.writeValue(response.getOutputStream(), ApiErrors.body(401, "Sign in to continue.", request));
                })
                .accessDeniedHandler((request, response, ex) -> {
                    response.setStatus(403); response.setContentType("application/json");
                    mapper.writeValue(response.getOutputStream(), ApiErrors.body(403, "Access denied.", request));
                }))
            .addFilterBefore(new SessionFilter(auth, mapper, origin), AnonymousAuthenticationFilter.class);
        return http.build();
    }
}
