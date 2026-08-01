# Personal Site — Plan

One-page personal site with a live **order book for buying my time with crypto** as the centerpiece, plus a concise resume/experience section and a blog. Design goal: hand-crafted and expensive-looking — the explicit opposite of "vibecoded." Based on three deep research passes (AI-slop tells, high-taste personal site patterns, crypto/order-book implementation).

---

## 1. The concept

**Ticker: `LIRON/USDC`.** The site is framed as a tiny single-asset exchange where the asset is my time.

- **Asks (sell side, red):** real, purchasable hour slots I post at tiered prices — e.g. `1.0h @ 300 ×2`, `1.0h @ 400 ×3`, `2.0h @ 550 ×1`. Every ask is honored: buying one takes you through crypto checkout and unlocks a booking link.
- **Bids (buy side, green):** visitors can post a bid ("1h @ $150 — help me with X"). Bids rest in the book; I can "hit" a bid to execute it. Stored in a lightweight backend.
- **Spread row** in the middle ("cheapest hour: $300"), **recent-trades tape** of past bookings, **depth bars** behind each level, green/red **flash-on-tick**, pulsing live dot.
- Fun stats reframed honestly: 24h volume = hours sold, last price = last booking, mid = "my market rate."

**Why this model (from research):** prior art (time.fun, friend.tech, $ALEX) used tokens/bonding curves — speculative, legally murky, misaligned with actually delivering hours. A plain bid/ask book of consulting hours is novel presentation nobody has used, and legally clean: non-transferable offers to buy a service, no token, no profit expectation → minimal securities risk. Publish a short terms blurb (what an hour includes, scheduling window, refund policy). USDC = ordinary income at receipt for taxes; record USD value per trade.

## 2. Payments

- **Primary: USDC on Base, direct wallet transfer** via `wagmi` + `viem` + RainbowKit (or Base Account SDK's one-tap pay button). 0% fees, self-custody, ~$0.001 gas, <2s confirm. The on-chain `Transfer` event is the "trade executed" record.
- **Fallback for wallet-less visitors: Coinbase Commerce / OnchainKit `<Checkout>`** (1% fee, hosted checkout, QR, settles to my wallet on Base).
- After payment confirms → success animation on the book ("FILLED"), trade prints to the tape, buyer gets a Cal.com booking link (scoped to the purchased duration) + email receipt.
- Flavor easter egg (later): an x402 `HTTP 402 Payment Required` endpoint, e.g. `curl liron.xyz/api/hour`.

## 3. Design direction — "Bloomberg terminal × blueprint grid"

Lock these tokens **before** building anything (research finding: slop = decisions left to defaults).

**Palette** — dark-first, tuned not inverted:
- Near-black surface with a slight hue tint (never pure `#000`), off-white text (never pure `#fff`).
- **Exactly one accent: amber/orange** (Bloomberg register — `#ff9900` family). Green/red reserved strictly for semantic bid/ask/tick colors.
- Banned: gradients of any kind, purple/indigo anywhere, soft diffuse shadows, glassmorphism/backdrop-blur.

**Typography:**
- **Mono for all numbers, labels, nav, metadata:** Berkeley Mono if willing to spend $75 (single strongest taste signal); free alternates: Geist Mono, JetBrains Mono, Commit Mono.
- **Body/headlines:** one quietly authoritative grotesque — Geist Sans or IBM Plex Sans (free) or Söhne/ABC Diatype (paid). **Never Inter.**
- `font-variant-numeric: tabular-nums lining-nums` everywhere numbers appear — non-negotiable for the book.
- Order book rows: ~13px / 1.4 line-height (best density-to-readability ratio). Tracking `-0.02em` at display sizes; `text-wrap: balance` on headings.

**Structure & texture:**
- 1px hairline borders, faint blueprint dot grid behind the book (`radial-gradient` dots, 16–24px spacing, ≤10% opacity), crosshair/registration corner marks.
- Border radius 0–4px. No `rounded-2xl`, no card grids of three, no cards-in-cards.
- Asymmetric layout rhythm (2fr/1fr splits, one full-bleed moment), spacing varied by importance — not uniform `py-20` sections.
- Barely-perceptible CSS grain/scanline texture (generated, not an image).

**Motion:**
- Native cross-document View Transitions between pages (>85% browser support, degrades gracefully).
- Micro-interactions 150–250ms, ease-out entering / ease-in leaving, custom cubic-bezier signature (`cubic-bezier(0.16,1,0.3,1)`); respect `prefers-reduced-motion`.
- Flash-on-change keyed to tick direction is THE signature detail. Nothing decorative animates.

**Anti-slop checklist (hard bans, from the tells research):**
- ❌ shadcn/Tailwind defaults, `max-w-7xl` centered hero, eyebrow pill + "Get Started/Learn More" button pair
- ❌ purple/indigo gradients, gradient text, glowing neon dark mode, floating blobs
- ❌ emoji-as-icons, ✨, 🚀; stats banners ("10K+ users"); "Trusted by" strips; pricing tables; FAQ accordions
- ❌ colored left-border accent strips on cards; hairline border + wide shadow on the same element
- ❌ fade-up-on-scroll on everything; uniform `duration-300 transition-all`
- ❌ the second-gen "tasteful AI" default too: cream + Instrument Serif italic hero + sage green
- ❌ weightless copy ("Build faster. Ship smarter.") — every line specific, first-person, in my voice
- ✅ styled `::selection`, custom `:focus-visible`, real 404, OG images, semantic HTML, alt text — the invisible finishing that signals care

## 4. Content & structure

Concise. Curation is the taste signal — 5–8 strong items, not exhaustive lists.

- **`/`** — single page:
  1. Intro: name + 2–3 specific lines about what I do. No hero theatrics; question-led or split layout, not a centered hero.
  2. **The order book** (full-bleed moment, the personality carrier).
  3. Experience: 5–8 curated entries, dense single-line format (`role — company — years — one concrete outcome`), rendered like a positions table to echo the trading theme. Link to PDF resume.
  4. Writing: latest 3–5 posts.
  5. Footer: real contact, wallet address, terms-for-hours blurb, colophon.
- **`/blog` + `/blog/[slug]`** — MDX, Shiki syntax highlighting, view transitions.
- **`/404`** — themed ("TICKER NOT FOUND").

## 5. Stack

- **Astro** (content-first, ~zero JS by default, MDX + Shiki built in, native view transitions) with **one React island** for the order book — exactly what islands architecture is for.
- **Styling:** plain CSS custom properties from a `DESIGN.md`/tokens file. No Tailwind default palette.
- **Order book island:** custom-built (~200 lines — two mapped lists + CSS depth bars + flash-on-change hook). Reference repos: `youfoundron/react-trading-ui`, `mihailgaberov/orderbook` (patterns only, no drop-in dependency is maintained).
- **Backend for bids/trades:** Supabase (Postgres + Realtime, free tier) — or Cloudflare Worker + Durable Object if we deploy on Cloudflare. Polling every 2–5s is fine at this scale; interpolated tick animation keeps it feeling live between polls.
- **Wallet:** wagmi + viem + RainbowKit, Base mainnet, USDC contract; verify payment client-side + tiny server check before issuing booking link.
- **Booking:** Cal.com (free, embeddable, API for scoped single-use links).
- **Deploy:** Vercel or Cloudflare Pages. Self-hosted variable fonts.

## 6. Build phases

1. **Tokens + scaffold** — DESIGN.md with final palette/type/spacing; Astro project; fonts; base layout with grid texture + hairlines.
2. **Order book UI (theater tier)** — real asks from a JSON/config file, simulated tape/tick animation, full visual polish. Ships standalone; already impressive.
3. **Payments** — wagmi/RainbowKit USDC-on-Base checkout on asks; Coinbase Commerce fallback; Cal.com link issuance.
4. **Bids backend** — Supabase table + submit form (wallet-signed message to prevent spam) + owner "hit bid" flow.
5. **Content** — experience section, resume, first blog posts, terms/refund blurb.
6. **Finishing pass** — view transitions, `::selection`/focus states, OG images, 404, a11y audit (WCAG 4.5:1 even in dark mode), Lighthouse, mobile.

## 7. Open decisions (need Liron's input)

1. **Accent color:** amber (Bloomberg) vs terminal green — amber recommended, green stays semantic.
2. **Berkeley Mono ($75)** vs free Geist Mono/JetBrains Mono.
3. **Chain:** Base + USDC assumed; Solana Pay is the alternative if you're a Solana person.
4. **Domain name** (affects wordmark/ticker styling).
5. **Pricing tiers + weekly hour inventory** for the initial asks.
6. **Resume content** — need roles/dates/outcomes, and whether blog has existing posts to migrate.
