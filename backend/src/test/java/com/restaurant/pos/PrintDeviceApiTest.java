package com.restaurant.pos;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class PrintDeviceApiTest {
    @Test void aStaffSessionCannotSubstituteForADeviceCredential() throws Exception {
        TenantJdbc db=mock(TenantJdbc.class);
        var controller=new PrintDeviceController(db);
        var filter=new SessionFilter(mock(AuthService.class),new ObjectMapper(),"http://localhost:5173",controller);
        var mvc=MockMvcBuilders.standaloneSetup(controller).setControllerAdvice(new ApiErrors()).addFilters(filter).build();
        mvc.perform(post("/api/print-device/claim").contentType("application/json").content("{}"))
            .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/print-device/start").header("Authorization","Bearer invalid")
                .contentType("application/json").content("{}"))
            .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/print-device/result").header("Authorization","Bearer invalid")
                .contentType("application/json").content("{}"))
            .andExpect(status().isUnauthorized());
        verifyNoInteractions(db);
    }
}
