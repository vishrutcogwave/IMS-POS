package com.restaurant.pos;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class DayEndEmailController {
    private final TenantJdbc db;
    private final DayEndEmailService emails;

    public DayEndEmailController(TenantJdbc db, DayEndEmailService emails) { this.db = db; this.emails = emails; }

    record SettingsInput(@NotNull @Size(max=5) List<@NotBlank @Email @Size(max=254) String> recipients,
                         @NotNull Boolean scheduled, @NotNull LocalTime sendTime) {}
    record SendInput(@NotNull LocalDateTime startAt, @NotNull LocalDateTime endAt) {}

    @PutMapping("/settings/branches/{branchId}/day-end-email")
    public Map<String,Object> settings(@PathVariable UUID branchId, @Valid @RequestBody SettingsInput input) {
        return emails.saveSettings(Actor.current(), branchId, input.recipients(), input.scheduled(), input.sendTime());
    }

    @PostMapping("/reports/day-end/branches/{branchId}/send")
    public Map<String,Object> send(@PathVariable UUID branchId, @Valid @RequestBody SendInput input) {
        Actor actor = Actor.current();
        return emails.sendNow(actor, branchId, input.startAt(), input.endAt());
    }
}
