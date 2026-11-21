package com.restaurant.pos;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.function.Supplier;

@Component
public class OperationsIdempotency {
    private final TenantJdbc db;
    private final ObjectMapper mapper;
    public OperationsIdempotency(TenantJdbc db,ObjectMapper mapper) { this.db=db; this.mapper=mapper; }

    public Object execute(Actor a,String key,String endpoint,Object body,boolean required,Runnable access,Supplier<?> work) {
        if(key==null || key.isBlank()) {
            if(required) throw new ApiException(400,"Idempotency-Key UUID is required");
            return db.tx(a,() -> { access.run(); return work.get(); });
        }
        try {
            if(!UUID.fromString(key).toString().equalsIgnoreCase(key)) throw new IllegalArgumentException();
        } catch(IllegalArgumentException ex) { throw new ApiException(400,"Idempotency-Key must be a UUID"); }
        String normalized=key.toLowerCase(Locale.ROOT);
        String hash=hash(endpoint,body);
        return db.tx(a,() -> {
            // Access is checked on retries as well: revoking an outlet also revokes cached responses.
            access.run();
            db.jdbc().queryForList("select pg_advisory_xact_lock(hashtextextended(?,0))",a.tenantId()+":"+a.userId()+":"+normalized);
            List<Map<String,Object>> saved=db.list("select operation,request_hash,response from request_keys where tenant_id=? and user_id=? and key=?",a.tenantId(),a.userId(),normalized);
            if(!saved.isEmpty()) {
                Map<String,Object> prior=saved.get(0);
                if(!endpoint.equals(prior.get("operation")) || !hash.equals(prior.get("request_hash")))
                    throw new ApiException(409,"Idempotency-Key was already used with a different endpoint or request");
                return prior.get("response");
            }
            Object result=work.get();
            db.update("insert into request_keys(tenant_id,user_id,key,operation,request_hash,response) values(?,?,?,?,?,?::jsonb)",a.tenantId(),a.userId(),normalized,endpoint,hash,db.json(result));
            // Read the persisted JSON on the first response too. This gives retries exactly
            // the same normalized representation (including decimal and object key encoding).
            return db.one("select response from request_keys where tenant_id=? and user_id=? and key=?",a.tenantId(),a.userId(),normalized).get("response");
        });
    }
    String hash(String endpoint,Object body) {
        try {
            byte[] canonical=mapper.writeValueAsBytes(canonical(mapper.valueToTree(body)));
            MessageDigest digest=MessageDigest.getInstance("SHA-256");
            digest.update(endpoint.getBytes(StandardCharsets.UTF_8)); digest.update((byte)0); digest.update(canonical);
            return HexFormat.of().formatHex(digest.digest());
        } catch(Exception ex) { throw new IllegalStateException("Unable to encode idempotent request",ex); }
    }
    private JsonNode canonical(JsonNode node) {
        if(node.isObject()) {
            ObjectNode sorted=mapper.createObjectNode();
            List<String> keys=new ArrayList<>(); node.fieldNames().forEachRemaining(keys::add); Collections.sort(keys);
            keys.forEach(key -> sorted.set(key,canonical(node.get(key)))); return sorted;
        }
        if(node.isArray()) { ArrayNode array=mapper.createArrayNode(); node.forEach(item -> array.add(canonical(item))); return array; }
        if(node.isNumber()) return mapper.getNodeFactory().numberNode(node.decimalValue().stripTrailingZeros());
        return node;
    }
}
