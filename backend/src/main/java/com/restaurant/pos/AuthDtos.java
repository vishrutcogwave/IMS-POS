package com.restaurant.pos;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public final class AuthDtos {
    private AuthDtos() {}
    public record Login(
            @NotBlank @Pattern(regexp="[a-z0-9][a-z0-9-]{1,62}[a-z0-9]", message="Use 3–64 lowercase letters, numbers or hyphens. Start and end with a letter or number.") String tenantSlug,
            @NotBlank @Email @Size(max=254) String email,
            @NotBlank @Size(max=72) String password) {}
    public record Onboard(
            @NotBlank @Size(max=160) String businessName,
            @NotBlank @Pattern(regexp="[a-z0-9][a-z0-9-]{1,62}[a-z0-9]", message="Use 3–64 lowercase letters, numbers or hyphens. Start and end with a letter or number.") String slug,
            @NotBlank @Size(max=120) String name,
            @NotBlank @Email @Size(max=254) String email,
            @NotBlank(message="Enter a password.") @Size(min=12,max=72,message="Use 12–72 characters.") String password) {}
    public record Profile(@NotBlank @Size(max=120) String name) {}
    public record Password(@NotBlank @Size(max=72) String currentPassword,
            @NotBlank @Size(min=12,max=72) String newPassword) {}
}
