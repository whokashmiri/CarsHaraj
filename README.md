# Haraj.com.sa Scraper (Node + Playwright + Stealth)

Features
- Stealth Chromium via `playwright-extra` + `puppeteer-extra-plugin-stealth`
- Login (username → next → password → login)
- Full scrape from the tag page (cars tag)
- For each ad:
  - opens the ad in a new tab
  - captures GraphQL responses for `posts` and `comments`
  - clicks “تواصل” to extract seller contact phone from the UI
  - stores/upserts into MongoDB
- New ads polling every 5 minutes:
  - stops a cycle when it hits N consecutive postIds that already exist in DB
- Comments refresh every 24 hours:
  - revisits stored ads and updates comments snapshot
- Structured logs in `./logs/`

## Install
```bash
npm i
npm run install:browsers
cp .env.example .env
# fill credentials + mongo
npm start
```

## Modes
By default it runs 3 loops:
1) Full scrape (once)
2) Poll new ads every `HARAJ_POLL_MINUTES`
3) Refresh comments every `HARAJ_COMMENTS_REFRESH_HOURS`

You can run a single mode:
```bash
MODE=full npm start
MODE=poll npm start
MODE=refresh npm start
```

## Data Model (Mongo)
- `COLLECTION_ADS` documents keyed by `_id = postId`
  - `postId`, `url`, `title`, `price`, `author`, `city`, `timeText`
  - `contact` (phone)
  - `gql.posts` and `gql.comments` snapshots (latest captured)
  - `updatedAt`, `createdAt`
- `COLLECTION_STATE` stores runtime cursor/state if needed later

> Note: Haraj UI and GraphQL can change; selectors are based on your provided HTML.
