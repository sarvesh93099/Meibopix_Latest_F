# Oracle backend + Vercel frontend: deployment walkthrough

Use this guide with the project folder `Meibo_EC2_Deploy/meibopix-latest-main`. Steps labelled **Windows** run in PowerShell on your computer. Steps labelled **Oracle** run in the SSH terminal on the VM. Replace uppercase placeholders before running commands.

The result is `https://YOUR-PROJECT.vercel.app` for visitors. Its `/api`, `/uploads`, and `/reports` routes proxy to your Oracle HTTPS API. Keep `VITE_API_URL` unset so staff sessions and guest image requests stay on the frontend origin.

Oracle's ARM profile omits MediaPipe because the pinned release has no Linux ARM wheel. Browser camera blink counting and browser recording analysis remain available. The legacy Python server-side recording recheck does not work on this profile; use a supported x86 host if you specifically need that API. Other ARM dependencies and real inference must be verified on the VM; this guide has not been executed on a live Oracle account.

1. **Create the Oracle VM.** Sign up at https://www.oracle.com/cloud/free/. Use an Always Free-eligible Ubuntu 24.04 ARM image and `VM.Standard.A1.Flex`, with 2 OCPUs and 12 GB RAM, subject to your tenancy's displayed free allocation. Use a 50 GB boot volume, a public subnet, and a public IPv4 address. Download the private SSH key securely. Stay within the account's Always Free quotas. Capacity can be unavailable and idle instances can be reclaimed; free does not guarantee continuous availability.

   Sources: [current Always Free limits](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), [launch an instance](https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/launchinginstance.htm).

2. **Open the Oracle network ports.** In the instance's VNIC/subnet security list or assigned network security group, add TCP ingress for port 22 from your public IP `/32`, and ports 80 and 443 from `0.0.0.0/0`. Do not expose port 5000; Flask binds to localhost behind nginx. Record the instance's public IPv4 address.

3. **Connect from Windows.** Replace the key path and IP:

   ```powershell
   ssh -i "C:\Users\taleg\Downloads\YOUR-ORACLE-KEY.key" ubuntu@YOUR-ORACLE-IP
   ```

   If Windows OpenSSH rejects the key permissions, restrict the key's ACL to your account through Properties > Security, then retry. Do not share the private key or paste it into source control.

4. **Obtain a backend hostname.** If you own a domain, point an API subdomain's A record to the Oracle IPv4 address. For a zero-cost subdomain, register a name such as `YOUR-NAME.duckdns.org` at https://www.duckdns.org/ and set its IP to the VM's public IPv4. Use that actual hostname everywhere this guide says `YOUR-API-HOST`. Update the DNS record if the VM address changes. Verify with `nslookup YOUR-API-HOST` on Windows before requesting a certificate.

5. **Upload the application and models.** First create the target directory in the **Oracle** SSH terminal:

   ```bash
   sudo mkdir -p /opt/meibography/meibography
   sudo chown ubuntu:ubuntu /opt/meibography/meibography
   ```

   In a second terminal on **Windows**, from your workspace root, package the project. This includes the four model checkpoints and excludes development dependencies, secrets, and existing patient data:

   ```powershell
   $projectPath = (Resolve-Path 'Meibo_EC2_Deploy/meibopix-latest-main').Path
   $archivePath = Join-Path $env:TEMP 'meibopix-oracle.tar.gz'
   tar.exe -czf $archivePath --exclude=.git --exclude=.env --exclude=.venv --exclude=node_modules --exclude=dist --exclude=artifacts --exclude=__pycache__ --exclude='*.db' --exclude=backend/uploads --exclude=backend/reports --exclude=backend/.smoke_runtime -C $projectPath .
   scp -i "C:\Users\taleg\Downloads\YOUR-ORACLE-KEY.key" $archivePath ubuntu@YOUR-ORACLE-IP:/home/ubuntu/meibopix-oracle.tar.gz
   ```

   Then in **Oracle**, extract into the empty target folder:

   ```bash
   tar -xzf /home/ubuntu/meibopix-oracle.tar.gz -C /opt/meibography/meibography
   cd /opt/meibography/meibography
   ls backend/meibography_models/*.pth
   ```

   You should see all four `.pth` files. Git LFS is not required. This deployment starts with a new database; migrate existing records separately if required.

6. **Create production configuration on Oracle.** Run:

   ```bash
   cd /opt/meibography/meibography
   cp deploy/oracle/production.env.example .env
   python3 -c 'import secrets; print(secrets.token_urlsafe(48)); print(secrets.token_urlsafe(24)); print(secrets.token_urlsafe(24))'
   nano .env
   ```

   Use the three generated values for `SECRET_KEY`, `AUTH_ADMIN_PASSWORD`, and `AUTH_BOOTSTRAP_PASSWORD`. Keep them private. The initial accounts are `site-admin` for approvals and `site-doctor` for the clinical workspace. Both placeholder passwords must be replaced. Keep `HOST=127.0.0.1`, secure cookies, HTTPS enforcement, local storage, and the absolute database/model paths from the template. You will replace `CORS_ORIGINS` with your actual Vercel production URL in step 10. Save in nano with Ctrl+O, Enter, Ctrl+X.

7. **Install and start the Oracle backend.** This script installs Python, Tkinter, nginx, the CPU ML dependencies, verifies checkpoint checksums, and configures systemd. It does not install Git LFS, AWS services, or the frontend on Oracle.

   ```bash
   API_DOMAIN=YOUR-API-HOST bash deploy/scripts/oracle_setup.sh
   curl http://127.0.0.1:5000/api/health
   sudo systemctl status meibography --no-pager
   ```

   The health response should return success. If setup fails, stop here and resolve the error before proceeding:

   ```bash
   sudo journalctl -u meibography -n 80 --no-pager
   ```

   Oracle's Ubuntu images may also have an OS firewall. If port 80 remains unreachable after opening the Oracle security rules, inspect it with `sudo iptables -L INPUT -n --line-numbers`. For the default iptables-based image, allow only the web ports and persist the rules:

   ```bash
   sudo apt-get install -y iptables-persistent
   sudo iptables -I INPUT 1 -p tcp -m multiport --dports 80,443 -j ACCEPT
   sudo netfilter-persistent save
   ```

   If you manage this VM with UFW instead, allow `OpenSSH` and `Nginx Full` using UFW; do not mix firewall managers or flush the existing SSH rules.

8. **Enable HTTPS on Oracle.** DNS must already point to the VM and port 80 must be reachable. On Ubuntu with snapd:

   ```bash
   sudo snap install --classic certbot
   sudo /snap/bin/certbot --nginx -d YOUR-API-HOST
   sudo /snap/bin/certbot renew --dry-run
   curl https://YOUR-API-HOST/api/health
   ```

   Enter your email when prompted and let Certbot configure HTTPS/redirection. Keep ports 80 and 443 available for certificate issuance/renewal. See [Ubuntu's certificate instructions](https://ubuntu.com/server/docs/how-to/security/obtain-tls-certificates/). Do not continue with an expired, self-signed, or missing certificate; the Vercel proxy needs a trusted HTTPS backend.

9. **Prepare and deploy the Vercel frontend.** On **Windows**, copy the template:

   ```powershell
   Copy-Item Meibo_EC2_Deploy/meibopix-latest-main/deploy/vercel/vercel.json.example Meibo_EC2_Deploy/meibopix-latest-main/frontend/vercel.json
   ```

   Open `frontend/vercel.json` and replace all three `REPLACE-ME.duckdns.org` values with `YOUR-API-HOST`. Keep the API/media proxy rules before the SPA fallback. The frontend's `VITE_API_URL` must be absent or empty; an absolute Oracle URL breaks the guest same-origin image allowlist and can create cross-site cookie problems.

   Create a private personal GitHub repository for the project folder and push the source, including the new `frontend/vercel.json`. Before pushing, confirm `.env`, `.pth`, databases, uploads, reports, and `node_modules` are excluded. The supplied `.gitignore` handles these for new, untracked files. If checkpoints were tracked before, follow `deploy/MODELS.md` to remove them from the Git index while retaining local files.

   In https://vercel.com/, choose Add New > Project and import that repository. Use the directory that contains `frontend/package.json` as the root:

   | Setting | Value |
   | --- | --- |
   | Framework | Vite |
   | Root directory if GitHub repo contains just the project | `frontend` |
   | Root directory if GitHub repo contains the entire workspace | `Meibo_EC2_Deploy/meibopix-latest-main/frontend` |
   | Install command | `npm ci` |
   | Build command | `npm run build` |
   | Output directory | `dist` |
   | `VITE_API_URL` | Leave unset |

   Deploy and record the production address, for example `https://YOUR-PROJECT.vercel.app`. Use that production address rather than a temporary preview URL. Vercel Hobby is for personal, non-commercial use: [plan rules](https://vercel.com/docs/plans/hobby), [Vite guide](https://vercel.com/docs/frameworks/frontend/vite). Do not run the existing AWS GitHub deployment jobs; leave `ENABLE_AUTO_DEPLOY` unset/false.

10. **Finish the backend origin setting.** On **Oracle**, edit `.env` and replace `CORS_ORIGINS` with the exact Vercel production origin, without a trailing slash:

    ```env
    CORS_ORIGINS=https://YOUR-PROJECT.vercel.app
    ```

    Restart:

    ```bash
    sudo systemctl restart meibography
    ```

    Keep `AUTH_COOKIE_SAMESITE=Lax` and secure cookies. Requests stay under the Vercel origin through external rewrites, rather than requiring third-party session cookies.

11. **Verify the public application.** Open `https://YOUR-PROJECT.vercel.app/api/health`; it should return backend JSON, not the React page. Then:

    - Open `/login`, enter the guest workspace, and refresh a nested route.
    - Run the manual blink calculator and a questionnaire; save/download a report.
    - In meibography, load a real sample and analyze it on Oracle.
    - Sign in as `site-doctor`; create a test patient and verify it survives an Oracle service restart.
    - Sign out and confirm protected records require sign-in.
    - Test your largest intended image and report downloads through Vercel.

    Test server-side inference separately using isolated test data:

    ```bash
    cd /opt/meibography/meibography
    .venv/bin/python deploy/scripts/manage_models.py verify
    .venv/bin/python backend/smoke_tests.py
    ```

    The first inference loads the models. Vercel external proxy requests have a 120-second timeout; verify cold and warm analysis on the actual ARM VM. If real jobs exceed that, an asynchronous job/polling flow is needed. Test upload sizes on the deployed proxy as well; do not bypass the guest allowlist by changing `VITE_API_URL`. [Vercel rewrite documentation](https://vercel.com/docs/routing/rewrites), [proxy limits](https://vercel.com/docs/limits).

12. **Keep data safe and update the site.** The SQLite database, uploads, and reports live on Oracle's persistent boot volume, outside the frontend deployment. Back them up independently of the VM; stop the service briefly for a consistent SQLite/file backup, or use SQLite's online backup API. Oracle can reclaim idle free instances, so the only copy should not be on that VM. A small single-server deployment can use SQLite; review concurrency and move to a suitable database before scaling.

    Frontend updates: push source to GitHub; Vercel rebuilds automatically. Backend updates: upload changed source while excluding `.env`, `.venv`, database, uploads, reports, and model files; rerun the shared dependency installer if requirements changed, then restart `meibography`. Reuse already-verified checkpoints. Do not rerun a full archive extraction over production patient data or reset production secrets on each update.
