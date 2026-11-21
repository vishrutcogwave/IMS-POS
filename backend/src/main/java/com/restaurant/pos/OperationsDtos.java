package com.restaurant.pos;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

public final class OperationsDtos {
    private OperationsDtos() {}

    public record CreateOrder(@NotNull UUID outletId, @NotBlank @Pattern(regexp="DINE_IN|TAKEAWAY|DELIVERY|ROOM_SERVICE") String serviceMode,
            UUID tableId, @NotNull @Min(1) @Max(100) Integer covers, @Size(max=2000) String notes, @Size(max=120) String customerName) {}
    public record AddItem(@NotNull @Min(0) Integer version, @NotNull UUID menuItemId, @NotNull @Min(1) @Max(999) Integer quantity,
            @Size(max=100) String variant, @Size(max=50) List<@NotBlank @Size(max=100) String> modifiers, @Size(max=2000) String notes) {}
    public record EditOrder(@NotNull @Min(0) Integer version, @Size(max=2000) String notes, @Size(max=120) String customerName,
            @DecimalMin("0") @Digits(integer=10,fraction=2) BigDecimal discount) {}
    public record EditItem(@NotNull @Min(0) Integer version, @NotNull @Min(1) @Max(999) Integer quantity, @Size(max=2000) String notes) {}
    public record Version(@NotNull @Min(0) Integer version) {}
    public record Cancel(@NotNull @Min(0) Integer version, @NotBlank @Size(max=2000) String reason) {}
    public record Reason(@NotBlank @Size(max=2000) String reason) {}
    public record Transfer(@NotNull @Min(0) Integer version, @NotNull UUID tableId, @NotBlank @Size(max=2000) String reason) {}
    public record BillPart(@NotNull UUID itemId, @NotNull @Min(1) @Max(999) Integer quantity) {}
    public record BillGroup(@NotEmpty @Size(max=500) List<@NotNull @Valid BillPart> items) {}
    public record CreateBills(@NotNull @Min(0) Integer version, @Size(min=1,max=100) List<@NotNull @Valid BillGroup> groups) {}
    public record Payment(@NotBlank @Size(max=30) String method, @NotNull @DecimalMin(value="0",inclusive=false) @Digits(integer=10,fraction=2) BigDecimal amount,
            @Size(max=160) String reference) {}
    public record Settle(@NotNull @Min(0) Integer version, @NotNull @Size(max=20) List<@NotNull @Valid Payment> payments,
            @DecimalMin("0") @Digits(integer=10,fraction=2) BigDecimal cashTendered) {}
    public record ModifyBill(@NotNull @Min(0) Integer version, @NotBlank @Size(max=2000) String reason,
            @NotNull @DecimalMin("0") @Digits(integer=10,fraction=2) BigDecimal discount) {}
    public record KotStatus(@NotBlank @Pattern(regexp="PREPARING|READY|SERVED") String status) {}
    public record PreviewItem(@NotNull UUID menuItemId, @NotNull @Min(1) @Max(999) Integer quantity) {}
    public record Preview(@NotNull UUID outletId, @NotEmpty @Size(max=500) List<@NotNull @Valid PreviewItem> items) {}
    public record Claim(@NotNull UUID outletId, @NotEmpty @Size(max=100) List<@NotBlank @Pattern(regexp="[A-Za-z0-9][A-Za-z0-9_.-]{0,99}") String> deviceKeys) {}
    public record Ack(@NotNull UUID claimToken, @NotBlank @Pattern(regexp="PRINTED|FAILED|UNCERTAIN") String status, @Size(max=2000) String error) {}
}
