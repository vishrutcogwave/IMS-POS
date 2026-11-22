package com.restaurant.pos;

import com.fasterxml.jackson.core.StreamReadConstraints;
import java.sql.SQLException;
import org.flywaydb.core.Flyway;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;

@SpringBootApplication(exclude = org.springframework.boot.autoconfigure.security.servlet.UserDetailsServiceAutoConfiguration.class)
public class PosApplication {
    public static void main(String[] args) throws SQLException {
        if (args.length == 1 && args[0].startsWith("--migrate-only=")) {
            migrateOnly(args[0].substring("--migrate-only=".length()));
            return;
        }
        SpringApplication.run(PosApplication.class, args);
    }

    private static void migrateOnly(String expectedDatabase) throws SQLException {
        if (expectedDatabase.isBlank()) {
            throw new IllegalArgumentException("Specify the expected database name with --migrate-only=<database>.");
        }
        var flyway = Flyway.configure()
                .dataSource(requiredEnv("DB_URL"), requiredEnv("DB_MIGRATION_USERNAME"),
                        requiredEnv("DB_MIGRATION_PASSWORD"))
                .locations("classpath:db/migration")
                .load();
        try (var connection = flyway.getConfiguration().getDataSource().getConnection()) {
            if (!expectedDatabase.equals(connection.getCatalog())) {
                throw new IllegalStateException("Connected database does not match --migrate-only.");
            }
        }
        flyway.migrate();
    }

    private static String requiredEnv(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Set " + name + " before running migrations.");
        }
        return value;
    }

    @Bean
    Jackson2ObjectMapperBuilderCustomizer boundedJson() {
        return builder -> builder.postConfigurer(mapper -> mapper.getFactory().setStreamReadConstraints(
                StreamReadConstraints.builder().maxNestingDepth(30).maxStringLength(20000)
                        .maxNumberLength(100).maxDocumentLength(1_048_576).build()));
    }
}
