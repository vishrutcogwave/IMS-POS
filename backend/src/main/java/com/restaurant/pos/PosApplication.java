package com.restaurant.pos;

import com.fasterxml.jackson.core.StreamReadConstraints;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;

@SpringBootApplication(exclude = org.springframework.boot.autoconfigure.security.servlet.UserDetailsServiceAutoConfiguration.class)
public class PosApplication {
    public static void main(String[] args) { SpringApplication.run(PosApplication.class, args); }
    @Bean
    Jackson2ObjectMapperBuilderCustomizer boundedJson() {
        return builder -> builder.postConfigurer(mapper -> mapper.getFactory().setStreamReadConstraints(
                StreamReadConstraints.builder().maxNestingDepth(30).maxStringLength(20000)
                        .maxNumberLength(100).maxDocumentLength(1_048_576).build()));
    }
}
