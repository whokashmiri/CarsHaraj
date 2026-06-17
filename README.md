# Haraj Real Estate Tag Scraper

Scrapes the Haraj real-estate tag page, opens each visible ad in a new tab, captures post/user/comments GraphQL responses, reads seller phone from the contact modal, and saves one MongoDB document per post.

## Setup

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

Fill `.env` with your Haraj credentials and MongoDB URI.

## Run

```bash
python -m src.main
```

## Important env values

```env
SCRAPE_CONCURRENCY=2
MAX_ADS_PER_RUN=0
MAX_LOAD_MORE_ROUNDS=0
```

`0` means unlimited. The scraper first clicks the `posts-load-more` button if present. When no button is present, it scrolls to trigger lazy loading.
