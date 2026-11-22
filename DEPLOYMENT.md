# 🚀 Restaurant POS — Deployment Documentation

**Deployed on:** 22 November 2026  
**Live URL:** https://pos.hiremathwebstudio.in  
**Server:** `root@201.18.205.217` (Ubuntu 26.04.1 LTS)  
**Project:** Hearth Table — Restaurant POS (React + Spring Boot + PostgreSQL)

---

## 📐 Architecture Overview

```
Browser (HTTPS)
      │
      ▼
Nginx (port 443/80)
  ├── Static files → /var/www/restaurant-pos  (React frontend)
  └── /api/* → proxy → 127.0.0.1:8082        (Spring Boot backend)
                              │
                              ▼
                   PostgreSQL (127.0.0.1:5432)
                   database: restaurant_pos
```

| Component | Technology | Location on Server |
|---|---|---|
| Frontend | React + Vite + TypeScript | `/var/www/restaurant-pos/` |
| Backend | Java 21 / Spring Boot 3.4 | `/opt/restaurant-pos/backend/hearth-pos-1.0.0.jar` |
| Database | PostgreSQL 17 | Native, `restaurant_pos` database |
| Process Manager | systemd | `restaurant-pos.service` |
| Web Server | Nginx + Let's Encrypt SSL | `/etc/nginx/sites-enabled/restaurant-pos` |

---

## 🖥️ Server State (Pre-existing — Not Changed)

The server already had a running application (IMS — Item Management System):

| Resource | IMS (Existing) | POS (New) |
|---|---|---|
| Java process port | `8080` | `8082` |
| Java version | Java 17 | Java 21 (newly installed) |
| Frontend path | `/var/www/item-management` | `/var/www/restaurant-pos` |
| Backend path | `/opt/item-management/backend/` | `/opt/restaurant-pos/backend/` |
| Systemd service | `item-management.service` | `restaurant-pos.service` |
| System user | `ims` | `pos` |
| Nginx domain | `hiremathwebstudio.in` | `pos.hiremathwebstudio.in` |
| Env file | `/etc/item-management.env` | `/etc/restaurant-pos.env` |
| PostgreSQL DB | existing DB | `restaurant_pos` |

---

## 📋 Step-by-Step Deployment

### PHASE 1 — Build Artifacts on Windows

Both artifacts were built locally since the server has no Node.js or Maven installed.

**Backend JAR** was already built at:
```
backend/target/hearth-pos-1.0.0.jar  (32 MB)
```
Built using local tools in `.tools/`:
- JDK: `.tools/jdk-21.0.13.1+2/`
- Maven: `.tools/apache-maven-3.9.9/`

**Frontend** was already built at:
```
frontend/dist/
```
Built using `npm --prefix frontend run build`.

---

### PHASE 2 — Upload Artifacts to Server

Run from local Windows PowerShell (not inside SSH):

```powershell
# Upload backend JAR
scp d:\POS\restaurant-pos-new\backend\target\hearth-pos-1.0.0.jar root@201.18.205.217:/tmp/hearth-pos.jar

# Upload frontend dist folder
scp -r d:\POS\restaurant-pos-new\frontend\dist root@201.18.205.217:/tmp/pos-frontend-dist
```

---

### PHASE 3 — Server Setup (via SSH)

SSH into server:
```bash
ssh root@201.18.205.217
```

#### Step 1 — Install Java 21

```bash
apt install -y openjdk-21-jre-headless
```

Installed at: `/usr/lib/jvm/java-21-openjdk-amd64/bin/java`  
> Note: Java 17 remains for IMS. Java 21 is used only by the POS service.

---

#### Step 2 — Create System User + Directories

```bash
useradd --system --no-create-home --shell /usr/sbin/nologin pos
mkdir -p /opt/restaurant-pos/backend
mkdir -p /var/www/restaurant-pos
```

Move uploaded files:
```bash
mv /tmp/hearth-pos.jar /opt/restaurant-pos/backend/hearth-pos-1.0.0.jar
cp -r /tmp/pos-frontend-dist/* /var/www/restaurant-pos/

chown -R pos:pos /opt/restaurant-pos
chown -R www-data:www-data /var/www/restaurant-pos
chmod -R 755 /var/www/restaurant-pos
```

---

#### Step 3 — PostgreSQL Database Setup

```bash
sudo -u postgres psql -d restaurant_pos << 'SQL'
CREATE USER pos_migrate WITH PASSWORD 'PosM1gr4te2026';
GRANT ALL PRIVILEGES ON DATABASE restaurant_pos TO pos_migrate;
GRANT ALL ON SCHEMA public TO pos_migrate;
CREATE USER pos_app WITH NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD 'PosApp2026';
GRANT CONNECT ON DATABASE restaurant_pos TO pos_app;
GRANT USAGE ON SCHEMA public TO pos_app;
ALTER DEFAULT PRIVILEGES FOR ROLE pos_migrate IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pos_app;
ALTER DEFAULT PRIVILEGES FOR ROLE pos_migrate IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO pos_app;
SQL
```

Two PostgreSQL roles created:
| Role | Purpose | Privileges |
|---|---|---|
| `pos_migrate` | Flyway DB migrations (runs at app startup) | DDL + full schema ownership |
| `pos_app` | Runtime app queries | DML only, no superuser, no bypass RLS |

> **Note:** Avoid `!` in passwords when using bash — it triggers history expansion. Use heredoc `<< 'SQL'` syntax instead.

---

#### Step 4 — Environment File

Created at `/etc/restaurant-pos.env` with permissions `640` (root:pos):

```env
DB_URL=jdbc:postgresql://127.0.0.1:5432/restaurant_pos
DB_USERNAME=pos_app
DB_PASSWORD=PosApp2026
DB_MIGRATION_USERNAME=pos_migrate
DB_MIGRATION_PASSWORD=PosM1gr4te2026
APP_ORIGIN=https://pos.hiremathwebstudio.in
APP_COOKIE_SECURE=true
APP_SEED_DEMO=false
APP_DOCS_ENABLED=false
APP_ONBOARDING_KEY=<generated via openssl rand -base64 48>
APP_PLATFORM_ADMIN_EMAIL=hvishrut5755@gmail.com
APP_PLATFORM_ADMIN_PASSWORD=<generated via openssl rand -base64 32>
SERVER_PORT=8082
```

> **Important:** `SERVER_PORT=8082` is required because port `8080` is already used by IMS.  
> **Important:** `APP_PLATFORM_ADMIN_PASSWORD` must be **at least 32 characters** — the app enforces this and will crash on startup if shorter.

Generate secrets:
```bash
openssl rand -base64 48 | tr -d '\n'   # for ONBOARDING_KEY
openssl rand -base64 32 | tr -d '\n'   # for ADMIN_PASSWORD
```

---

#### Step 5 — Systemd Service

Created at `/etc/systemd/system/restaurant-pos.service`:

```ini
[Unit]
Description=Restaurant POS Spring Boot Application
After=network.target postgresql.service

[Service]
Type=simple
User=pos
WorkingDirectory=/opt/restaurant-pos/backend
EnvironmentFile=/etc/restaurant-pos.env
ExecStart=/usr/lib/jvm/java-21-openjdk-amd64/bin/java -jar /opt/restaurant-pos/backend/hearth-pos-1.0.0.jar
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=restaurant-pos

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable restaurant-pos
systemctl start restaurant-pos
```

> Spring Boot runs Flyway DB migrations automatically at startup using the `pos_migrate` credentials.

---

#### Step 6 — Nginx Configuration

Created at `/etc/nginx/sites-available/restaurant-pos`:

```nginx
server {
    server_name pos.hiremathwebstudio.in;

    root /var/www/restaurant-pos;
    index index.html;

    client_max_body_size 12m;

    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8082;
        proxy_http_version 1.1;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    listen 80;
}
```

Enabled:
```bash
ln -s /etc/nginx/sites-available/restaurant-pos /etc/nginx/sites-enabled/restaurant-pos
nginx -t
systemctl reload nginx
```

---

#### Step 7 — DNS Record

Added in domain registrar for `hiremathwebstudio.in`:

| Type | Name | Value | TTL |
|---|---|---|---|
| `A` | `pos` | `201.18.205.217` | `300` |

---

#### Step 8 — SSL Certificate

```bash
certbot --nginx -d pos.hiremathwebstudio.in
```

Certificate auto-installed by Certbot into Nginx config.  
**Expires:** 2027-02-20 (auto-renews via systemd timer)

---

## 🔐 Platform Admin Login

| Field | Value |
|---|---|
| **URL** | https://pos.hiremathwebstudio.in |
| **Property ID** | `@platform` |
| **Email** | `hvishrut5755@gmail.com` |
| **Password** | *(stored securely — generated via openssl)* |

> Restaurant staff log in with their **restaurant slug** as Property ID, not `@platform`.

---

## 🛠️ Useful Commands (on server)

```bash
# Check service status
systemctl status restaurant-pos

# View live logs
journalctl -u restaurant-pos -f

# Restart service
systemctl restart restaurant-pos

# Check port
ss -tlnp | grep 8082

# Check nginx
nginx -t && systemctl reload nginx

# View env file (secrets)
cat /etc/restaurant-pos.env
```

---

## 🔄 How to Update / Redeploy

**On Windows — rebuild and upload:**
```powershell
# Rebuild JAR (if backend changed)
$env:JAVA_HOME = "d:\POS\restaurant-pos-new\.tools\jdk-21.0.13.1+2"
$env:PATH = "$env:JAVA_HOME\bin;" + $env:PATH
d:\POS\restaurant-pos-new\.tools\apache-maven-3.9.9\bin\mvn.cmd -f d:\POS\restaurant-pos-new\backend\pom.xml clean package -DskipTests
scp d:\POS\restaurant-pos-new\backend\target\hearth-pos-1.0.0.jar root@201.18.205.217:/opt/restaurant-pos/backend/hearth-pos-1.0.0.jar

# Rebuild frontend (if frontend changed)
npm --prefix d:\POS\restaurant-pos-new\frontend run build
scp -r d:\POS\restaurant-pos-new\frontend\dist\* root@201.18.205.217:/var/www/restaurant-pos/
```

**On server — restart:**
```bash
systemctl restart restaurant-pos
journalctl -u restaurant-pos -f
```

---

## ⚠️ Lessons Learned During Deployment

| Issue | Cause | Fix |
|---|---|---|
| `!` in bash password caused `event not found` | Bash history expansion | Use heredoc `<< 'SQL'` or avoid `!` in passwords |
| Spring Boot crashed: `password must be 32+ chars` | Admin password too short | Use `openssl rand -base64 32` for passwords |
| Port 8082 not listening | Spring Boot defaulting to 8080 (taken by IMS) | Add `SERVER_PORT=8082` to env file |
| `scp` ran on server instead of local | Commands pasted in wrong terminal | Run `scp` in local PowerShell, not inside SSH session |
| `apt` command failed in PowerShell | Ran Linux command in Windows terminal | Switch to SSH terminal for server commands |

---

## 📁 Server File Structure

```
/
├── opt/
│   └── restaurant-pos/
│       └── backend/
│           └── hearth-pos-1.0.0.jar   ← Spring Boot app
├── var/www/
│   └── restaurant-pos/
│       ├── index.html                  ← React frontend entry
│       ├── assets/                     ← JS/CSS bundles
│       ├── fonts/
│       ├── hotel-sign-in.jpg
│       ├── pos-hotel-logo.png
│       └── pos-icon.png
├── etc/
│   ├── restaurant-pos.env              ← All secrets/config
│   ├── nginx/sites-available/
│   │   └── restaurant-pos              ← Nginx config
│   └── systemd/system/
│       └── restaurant-pos.service      ← Process manager
└── etc/letsencrypt/live/
    └── pos.hiremathwebstudio.in/       ← SSL certificates
```
