package com.restaurant.pos;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

public final class CatalogDtos {
    private CatalogDtos() {}
    public record Business(@NotBlank @Size(max=160) String name,
            @NotNull @Size(max=2000) String receiptAddress, @NotNull @Size(max=80) String taxNumber,
            @NotNull @Size(max=40) String phone, @NotNull @Size(max=1000) String receiptFooter) {}
    public record Branch(@NotBlank @Size(max=120) String name, @NotNull @Size(max=2000) String address) {}
    public record Outlet(@NotNull UUID branchId, @NotBlank @Size(max=120) String name,
            @NotNull @Size(min=1,max=4) List<@NotNull @Pattern(regexp="DINE_IN|TAKEAWAY|DELIVERY|ROOM_SERVICE") String> serviceModes,
            @NotNull @Size(min=1,max=3) List<@NotNull @Pattern(regexp="CASH|CARD|UPI") String> paymentMethods,
            @NotBlank @Pattern(regexp="[A-Z]{3}") String currency,
            @NotBlank @Size(max=80) String timezone) {}
    public record CreateUser(@NotBlank @Size(max=120) String name,
            @NotBlank @Email @Size(max=254) String email,
            @NotBlank @Size(min=12,max=72) String password,
            @NotNull @Pattern(regexp="OWNER|MANAGER|CASHIER|WAITER|KITCHEN|ACCOUNTANT") String role,
            @NotNull @Size(max=100) List<@NotNull UUID> outletIds) {}
    public record UpdateUser(@NotBlank @Size(max=120) String name,
            @NotBlank @Email @Size(max=254) String email,
            @NotNull @Pattern(regexp="OWNER|MANAGER|CASHIER|WAITER|KITCHEN|ACCOUNTANT") String role,
            @NotNull @Size(max=100) List<@NotNull UUID> outletIds, @NotNull Boolean active) {}
    public record Category(@NotNull UUID outletId, @NotBlank @Size(max=100) String name,
            @NotBlank @Size(max=100) String department, @NotNull @Min(-10000) @Max(10000) Integer sortOrder) {}
    public record Option(@NotBlank @Size(max=100) String name,
            @NotNull @DecimalMin("0.00") @DecimalMax("9999999999.99") @Digits(integer=10,fraction=2) BigDecimal price) {}
    public record Item(@NotNull UUID outletId, @NotNull UUID categoryId,
            @NotBlank @Size(max=140) String name, @NotNull @Size(max=4000) String description,
            @NotNull @DecimalMin("0.00") @DecimalMax("9999999999.99") @Digits(integer=10,fraction=2) BigDecimal price,
            @NotNull @DecimalMin("0.00") @DecimalMax("100.00") @Digits(integer=3,fraction=2) BigDecimal taxRate,
            @NotNull Boolean available, @NotNull Boolean vegetarian,
            @NotNull @Size(max=30) List<@NotNull @Valid Option> variants,
            @NotNull @Size(max=30) List<@NotNull @Valid Option> modifiers) {}
    public record Table(@NotNull UUID outletId, @NotBlank @Size(max=40) String name,
            @NotBlank @Size(max=80) String section, @NotNull @Min(1) @Max(100) Integer seats) {}
    public record Printer(@NotNull UUID outletId, @NotBlank @Size(max=100) String name,
            @NotBlank @Pattern(regexp="[A-Za-z0-9][A-Za-z0-9_-]{0,99}") String deviceKey,
            @NotNull @Pattern(regexp="KOT|BILL|BOTH") String documentType,
            @NotNull Integer paperWidth, @NotNull @Min(1) @Max(5) Integer copies,
            @NotNull Boolean enabled, @NotNull Boolean isFallback, @NotNull Boolean isReceipt,
            @NotNull @Pattern(regexp="STANDARD|COMPACT") String template) {}
    public record Route(@NotNull UUID categoryId, @NotNull UUID printerId) {}
    public record Routes(@NotNull UUID outletId, @NotNull @Size(max=200) List<@NotNull @Valid Route> routes) {}
}
