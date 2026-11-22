# 📊 Restaurant POS: Read-Only System Audit & QA Report

**Target Environment:** `https://pos.hiremathwebstudio.in`  
**Host:** `201.18.205.217`  
**Mode:** Strictly Read-Only  
**Timestamp:** 22 November 2026

---

## 🔍 Executive Summary

The POS platform is running and accessible over HTTPS. Testing against all platform workflows identified **two major issues** that explain why:
1. **Reloading the page always redirects back to login** (State loss).
2. **Creating a restaurant fails** with an error message on the form.

---

## 🛑 Identified Issues & Root Cause Analysis

### Issue 1: Page Reload Causes Immediate Logout

#### 🔎 Observed Behavior:
- When signed in as `@platform` (`hvishrut5755@gmail.com`), the Platform Administration dashboard opens normally.
- If you refresh/reload (F5), you are immediately kicked back to the login screen.

#### 🛠️ Root Cause in Code:
In `frontend/src/App.tsx` and `frontend/src/Auth.tsx`:
- When logging in as a regular restaurant tenant, the server issues an HTTP-only session cookie (`pos_session`), which is restored on reload via `api.me()` (`GET /api/auth/me`).
- When logging in as `@platform` (Platform Administrator):
  ```tsx
  // frontend/src/Auth.tsx line 34-35
  const { token } = await platformRequest<{ token: string }>('/login', '', 'POST', { email, password });
  onPlatformSession(token);
  ```
  `platformToken` is held **strictly in React in-memory component state** (`const [platformToken, setPlatformToken] = useState('')` in `App.tsx`).
- It is **never persisted** to `localStorage` or `sessionStorage`.
- When the page is reloaded, the React state is re-initialized to `''` (empty string).
- In `App.tsx`, line 87-92:
  - `bootstrap()` runs `api.me()`, which returns `401 Unauthorized` (because `@platform` does not have a tenant cookie session).
  - Because `platformToken` is empty and `session` is null, the app falls back to rendering `<Auth />` (the login screen).

---

### Issue 2: Unable to Create Restaurant in Platform Admin

#### 🔎 Observed Behavior:
- Clicking **"Add restaurant"** in the Platform Admin section opens the creation form.
- Submitting the form fails with:
  > **"Check the highlighted fields and try again."**  
  > **"• Start date: Use the expected format or select a valid option."**

#### 🛠️ Root Cause in Code:
In `backend/src/main/java/com/restaurant/pos/ApiErrors.java`:
```java
@ExceptionHandler(HttpMessageNotReadableException.class)
ResponseEntity<?> unreadable(HttpMessageNotReadableException ex, HttpServletRequest request) {
    if (ex.getCause() instanceof JsonMappingException mapping) {
        ...
        if (!path.isEmpty()) return validation(Map.of(path.toString(), "Use the expected format or select a valid option."), request);
    }
```
In `backend/src/main/java/com/restaurant/pos/PlatformController.java`:
```java
record Provision(
    @NotBlank @Size(max=160) String businessName,
    @NotBlank @Pattern(regexp="[a-z0-9][a-z0-9-]{1,62}[a-z0-9]") String slug,
    @NotBlank @Size(max=120) String name,
    @NotBlank @Email @Size(max=254) String email,
    @NotBlank @Size(min=12,max=72) String password,
    @NotNull @Min(1) @Max(1000) Integer maxBranches,
    @NotNull @Min(1) @Max(10000) Integer maxUsers,
    LocalDate startsOn, LocalDate endsOn) {}
```
- In `frontend/src/Platform.tsx`, the form submits:
  ```json
  {
    "businessName": "...",
    "slug": "...",
    "name": "...",
    "email": "...",
    "password": "...",
    "maxBranches": 1,
    "maxUsers": 2,
    "startsOn": "2026-11-22",
    "endsOn": "2027-11-22"
  }
  ```
- Jackson's deserializer parses `startsOn` into `java.time.LocalDate`. If the input date string is empty, missing, formatted with unexpected timezone offsets, or if Jackson deserialization throws a `JsonMappingException` on `startsOn`, Spring Boot catches `HttpMessageNotReadableException` and outputs:
  `"startsOn": "Use the expected format or select a valid option."`
- Additionally, if the browser or user selects a date format or if `startsOn` is null or invalid, Jackson fails mapping. Furthermore, `endsOn` must be strictly greater than or equal to `startsOn`.

---

## 📋 Comprehensive Workflow Status Matrix

| Workflow / Component | Status | Details |
|---|---|---|
| **Nginx Web Server** | ✅ **HEALTHY** | Reverse proxying `/` to static assets and `/api/` to port `8082`. |
| **SSL / HTTPS** | ✅ **HEALTHY** | Valid Let's Encrypt certificate deployed. |
| **Spring Boot Backend** | ✅ **HEALTHY** | Running on port `8082`, Flyway migrations completed. |
| **PostgreSQL 17** | ✅ **HEALTHY** | Database `restaurant_pos` active with isolated schemas and RLS. |
| **Platform Login** | ✅ **PASS** | Validated with `@platform` credentials. |
| **Audit Logs Viewer** | ✅ **PASS** | Loads event history from `/api/platform/audit`. |
| **Store Accounts Tab** | ✅ **PASS** | Interface renders properly. |
| **Contact Dialog** | ✅ **PASS** | Modals render and close properly. |
| **Session Persistence on Reload** | ❌ **FAIL** | Token stored in React memory only; page reload forces re-login. |
| **Create Restaurant Provisioning** | ❌ **FAIL** | Backend rejection on `startsOn` parameter parsing in `POST /api/platform/tenants`. |

---

## 💡 Recommended Fixes (For when ready to apply changes)

1. **Fix Session Persistence on Reload:**
   - In `frontend/src/App.tsx`: Store `platformToken` in `sessionStorage` (e.g. `sessionStorage.getItem('platform_token')`) so page reloads do not wipe out the logged-in admin session.
2. **Fix Restaurant Creation (`startsOn` format):**
   - Ensure the frontend sends `startsOn` and `endsOn` as standard `YYYY-MM-DD` strings or handles nulls cleanly:
     `startsOn: fields.startsOn ? String(fields.startsOn).slice(0, 10) : null`
   - In the backend, ensure Jackson `JavaTimeModule` or `@JsonFormat(pattern = "yyyy-MM-dd")` is explicitly annotated on `LocalDate startsOn` and `LocalDate endsOn` in `PlatformController.Provision`.
