# Bongonari

Bongonari is a local storefront backed by Node.js and SQLite. The shop is served at `http://127.0.0.1:8000/`; store accounts and product management are at `/admin.html`.

## Start the site

Install Node.js 22.13 or newer, then run the **Run Bongonari storefront** task in VS Code, or run `powershell -NoProfile -ExecutionPolicy Bypass -File .\serve.ps1`.

On first visit to `/admin.html`, set the website owner's username and a password with at least 12 characters. The site creates the `dev` account with a random, one-time password and signs you in as the owner:

- Your chosen username (for example, `Arpan`) — Website Owner; can add products and edit product details and prices.
- `dev` — Developer; can sign in and view the catalog, but cannot change products. Copy and securely share the generated password from the owner dashboard before refreshing or signing out. The password is shown only once, and the developer can change it after signing in.

Passwords are stored as salted scrypt hashes. Account and product data persists in `data/sunday-supply.sqlite`; stop the server before copying that file for a backup. Both accounts can change their password after signing in.

Choose a JPEG, PNG, or WebP picture directly from your device when adding a product; uploads are limited to 5 MB and are stored locally in `data/product-images`. When editing a product, leave the picture picker empty to keep its current image, or choose another image to replace it. Existing HTTPS image URLs continue to work. Product prices are entered and displayed in Indian rupees (INR), and existing price amounts are kept unchanged when switching from USD labels. New product IDs are generated automatically. The category list includes Home, Wear, Objects, Electronics, Beauty & Personal Care, Footwear, Bags & Accessories, Jewellery, Books & Stationery, Toys & Games, Sports & Outdoors, Grocery & Gourmet, Health & Wellness, Baby & Kids, Kitchen & Dining, Furniture, Art & Crafts, Pet Supplies, and Travel. The checkout button is still a placeholder; this site does not process payments.

## Publish the website

`render.yaml` provides a Render deployment with HTTPS, a persistent disk for SQLite and uploaded product pictures, and an application health check. To publish it, push this project to a private GitHub repository, connect that repository to Render, and create a Blueprint instance from `render.yaml`. Render requires a paid web-service plan for the persistent disk.

After deployment, open `/admin.html` on the public address and complete the one-time owner setup with a new, unique password. Do not reuse the local-development password. The deployed service starts with the sample catalog; existing local account and product data are not copied automatically.

## Local-development security boundary

The server binds to `127.0.0.1` and is intended for local development only. Sessions are held in memory and use `HttpOnly` and `SameSite=Strict` cookies; because the local server uses HTTP, cookies cannot use the `Secure` attribute. Do not expose this server to a public network or use it for a live store without HTTPS, secure deployment configuration, and an appropriate production session store.

## Test

Run `npm test` with Node.js available on `PATH`.
