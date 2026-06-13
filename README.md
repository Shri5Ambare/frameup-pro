# FrameUp Pro — Full-Stack Profile Frame & Social Graphics Generator

A full-stack web app that lets supporters of local campaigns, colleges, and festivals put a branded frame on their profile picture — no Canva, no Photoshop, no account, and photos never leave the device (only frame designs are stored on the server, never user photos).

**Run it:**

```
node server.js
```

then open http://localhost:3000. **Zero npm dependencies** — the backend uses Node's built-in `node:http` and `node:sqlite` (Node 22.5+; tested on Node 24). The database is created automatically at `data/frameup.db` and seeded with sample community frames **and an admin account** on first run:

> **Admin login:** `admin@frameup.local` / `admin123` — change this in production!

## Accounts & login (required for all services)

Every user must sign in before using the app — the whole UI sits behind a login screen.

- **Email + password** — passwords hashed with scrypt + per-user salt; sessions are HttpOnly cookies (30 days) stored server-side, so logout and bans take effect immediately.
- **Google Sign-In** — set `GOOGLE_CLIENT_ID=<your OAuth client id>` and the Google button appears automatically; ID tokens are verified server-side against Google and the audience is checked. Google and email accounts with the same address merge into one.
- Published frames, leads, and orders are tied to your **account**, so your campaigns follow you across devices (the old browser-only owner-key links still work as a legacy fallback).

Auth API: `POST /api/auth/register · login · google · logout`, `GET /api/auth/me`, `GET /api/auth/config`. Everything outside `/api/auth/*` and the payment callbacks requires a session; `/api/admin/*` additionally requires the admin role.

## Admin panel — `/admin`

A separate web panel for operators (admin role required; everyone else sees an access-denied screen):

- **Overview** — live stats: users, banned, frames, total downloads, leads, orders, paid revenue in NPR
- **Users** — search, **ban/unban** (kills their sessions instantly), **promote/demote admin**, **delete** (removes their frames + leads too); you can't ban or delete yourself
- **Frames** — every published frame with owner, downloads, leads; view or delete any
- **Orders** — all payments with user, plan, provider, status, and unlock codes
- **Leads** — every collected supporter email across all campaigns

## Design

Fully redesigned: light theme, Inter typeface, indigo→fuchsia gradient branding, soft-shadow cards, a split-hero login screen, and a matching admin console.

## Backend API

| Route | What it does |
|---|---|
| `GET /api/frames?sort=popular\|recent&q=` | Public community gallery (search + sort) |
| `GET /api/frames/:id` | Fetch one frame (powers `/f/:id` short links) |
| `POST /api/frames` | Publish a frame → returns `{id, ownerKey}` |
| `POST /api/frames/:id/download` | Increment the server-side download count |
| `POST /api/frames/:id/leads` | Supporter submits email (gated frames) |
| `GET /api/frames/:id/leads?key=` | Owner-only: read collected leads |
| `DELETE /api/frames/:id?key=` | Owner-only: unpublish |

Ownership is a secret `ownerKey` returned at publish time and kept in the creator's browser — no accounts needed, which keeps friction at zero for $25 one-off customers. PNG-overlay frames (too big for URL-hash links) get short `/f/:id` server links too.

## 🇳🇵 Nepal payment system (eSewa + Khalti)

Real online checkout for Nepali customers, built into the pricing page:

| Route | What it does |
|---|---|
| `GET /api/pay/config` | Which providers are enabled + NPR prices |
| `POST /api/pay/initiate` | Create an order, returns signed eSewa form fields or a Khalti payment URL |
| `GET /api/pay/esewa/callback` | eSewa success redirect — HMAC-SHA256 signature verified server-side |
| `GET /api/pay/khalti/callback` | Khalti return — verified via the ePayment lookup API |
| `GET /api/orders/:id` | Order status (+ unlock code once paid) |
| `POST /api/unlock` | Validate a purchased Pro code (works across devices) |

**Plans:** Pro unlock रू500 · Campaign template रू3,500 · Campaign Pro रू7,000.

**eSewa works out of the box in test mode** using the public UAT credentials (`EPAYTEST` merchant). Try it: click "eSewa — Pro unlock रू500", then log in on the sandbox with eSewa ID `9806800001` (password `Nepal@123`, token `123456`). On success you're redirected back, the order is verified by signature, Pro unlocks automatically, and you get a permanent `FRAME-XXXX-XXXX` code.

**Go live** with environment variables — no code changes:

```
ESEWA_LIVE=1  ESEWA_PRODUCT_CODE=<your merchant code>  ESEWA_SECRET=<your secret key>
KHALTI_SECRET_KEY=<your live secret key>  KHALTI_LIVE=1
```

Khalti's button appears automatically once `KHALTI_SECRET_KEY` is set (use a [dev.khalti.com](https://dev.khalti.com) sandbox key for testing). Security notes: callback signatures are verified server-side (tampered amounts are rejected), order completion is idempotent, and unlock codes are only revealed for paid orders.

## Features

### Make My Picture (supporter side)
- Drag-and-drop photo upload, drag to pan, scroll/pinch to zoom, rotate, flip
- Photo filters: presets (Vivid, B&W, Sepia, Cool) + brightness/contrast/saturation sliders
- **5 export formats**: FB Profile 1080×1080 (circle), WhatsApp DP 640×640, IG Post 1080×1080, Story 1080×1920, FB Cover 1640×856 — story/cover get an auto-generated blurred-photo backdrop behind the framed circle
- Download HD PNG or copy the image straight to the clipboard for pasting into Facebook
- Free tier adds a small watermark; Pro unlock removes it (demo code: `FRAME-PRO-2026`)

### Frame Studio (creator side — anyone can make a frame)
- Ring: gradient / solid / double styles, two colors, adjustable width, dot & sparkle patterns
- Arc text top and bottom with 5 font styles
- Banner: pill or ribbon style
- **Emoji stickers**: click to add, drag into place on the live preview, double-click to remove
- **Logo upload**: drag to position, slider to resize
- Or upload a full transparent PNG overlay instead
- Live preview over a head-and-shoulders silhouette to judge face clearance
- **Email gate** (Pro): require supporters to leave their email before downloading

### Community & campaign tools (full-stack)
- **🌍 Publish & share**: anyone can publish their frame to the public Community gallery with their name/organization shown as the creator
- **Community gallery**: browse, search, and sort (popular/newest) frames published by everyone; one click to use any frame
- **Short share links** (`/f/:id`): open the app with the frame pre-loaded — works for PNG-overlay frames too, and supports QR codes for posters and event booths
- **Server-side stats**: download counts across *all* supporters, not just one device
- **Server-side lead capture**: email-gated frames collect supporter emails on the server; only the frame's owner (via secret owner key) can read or CSV-export them
- **My Campaigns dashboard**: local frames + published frames with live server stats, unpublish, links, QR, leads

## Revenue model

| Stream | Price | How |
|---|---|---|
| Custom campaign template | $25 flat | You design the frame, send a campaign link + QR |
| Campaign Pro | $50 flat | Email capture, 3 variations, cover/story graphics |
| White-label | $99/mo | Their logo/domain, unlimited frames, lead exports |
| Individual Pro unlock | $5 one-time | Removes the watermark |
| Featured frames | $10/wk | Pin a business's frame atop the public gallery |
| Seasonal bundles | $99 | 5-frame packs for graduation/election/festival season |
| Print upsell | margin | Buttons, stickers, yard signs via print-on-demand |

The watermark is the growth engine: every shared image advertises the tool to the next organization. The email gate makes supporter lists — the real product for political campaigns — a paid feature.

## Going to production

1. Replace `mailto:` order buttons with Stripe Payment Links.
2. Deploy `server.js` to any Node host (Railway, Render, Fly.io, a $5 VPS) behind HTTPS on a real domain; back up `data/frameup.db`.
3. Add moderation (report button + admin review queue) before the community gallery is fully public.
4. Featured (paid) gallery slots and seasonal categories; rate-limit publishing per IP.
5. Optional accounts (email magic links) so creators can access campaigns from multiple devices — the owner-key model is single-browser.

## Privacy

All image processing happens in the browser via canvas. Photos are never uploaded anywhere — a genuine trust point worth advertising to campaigns and their supporters. (Leads in this demo are stored in `localStorage` only.)
