# Deploy the IMS-POS frontend

Public address: [pos.hiremathwebstudio.in](https://pos.hiremathwebstudio.in)

This guide assumes a Linux host with Docker Compose, Nginx and Certbot. The host Nginx terminates HTTPS. The frontend container serves the app and passes `/api/` requests to the Spring Boot backend over the private Compose network.

## 1. Point DNS at the server

In the DNS control panel for `hiremathwebstudio.in`, point the `pos` A record at the server's public IPv4 address. Add an AAAA record only if the server serves the site over IPv6. Allow inbound TCP ports 80 and 443 and confirm DNS resolves to the intended server before issuing the certificate.

## 2. Build and start the app

Complete [Backend deployment](Backend-Deployment.md) first to prepare PostgreSQL and the production environment file. From the IMS-POS repository root, run this using the release revision you intend to deploy.

```bash
docker compose -p ims-pos-production --env-file /etc/ims-pos/production.env -f compose.production.yaml -f /etc/ims-pos/compose.tls.yaml up -d --build
docker compose -p ims-pos-production --env-file /etc/ims-pos/production.env -f compose.production.yaml -f /etc/ims-pos/compose.tls.yaml ps
curl -I http://127.0.0.1:8181/
```

With `POS_HTTP_PORT=8181`, the production Compose file exposes the frontend on `127.0.0.1:8181`. If you selected a different free port, update both the checks and the Nginx upstream below. Use the POS-only project name `ims-pos-production` for all POS Compose commands. Run the two containers as the same Compose project so the frontend can resolve the backend by its service name.

## 3. Configure HTTPS

On an Ubuntu or Debian host using the standard Nginx directory layout, create `/etc/nginx/sites-available/ims-pos` with:

```nginx
server {
    listen 80;
    server_name pos.hiremathwebstudio.in;
    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:8181;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Add only the POS site to the existing reverse proxy. Keep the IMS site and certificate in place. Check the complete Nginx configuration before reloading and request a certificate for the POS hostname only. Verify both the existing IMS URL and the new POS URL after the reload.

```bash
sudo ln -s /etc/nginx/sites-available/ims-pos /etc/nginx/sites-enabled/ims-pos
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx --redirect -d pos.hiremathwebstudio.in
sudo certbot renew --dry-run
```

## 4. Verify in production

```bash
curl -I https://pos.hiremathwebstudio.in/
curl -sS -o /dev/null -w '%{http_code}\n' https://pos.hiremathwebstudio.in/api/auth/me
```

The login page should load over HTTPS. The unauthenticated API check should return `401`. A `502` usually means a proxy cannot reach its upstream. Check Compose status and logs before testing logins.

Keep the production TLS override in the Compose commands when using the CA mount in the backend guide. From the shared login page, use Property ID `@platform` with the production administrator email and password configured in the [backend guide](Backend-Deployment.md#platform-administrator-login). Staff use their restaurant's Property ID and their own credentials. For silent KOT and bill printing, follow the [POS Print Bridge guide](POS-Print-Bridge.md) after the site is reachable.
