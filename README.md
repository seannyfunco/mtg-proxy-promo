# MTG Proxy Promo Randomizer

A lightweight web app that helps run a Magic: The Gathering league promo process by:

1. Selecting a set from a dropdown.
2. Fetching **3 different random Rare cards** from that set via Scryfall.
3. Randomly assigning one of those 3 rares to a player.

## Features

- Set picker populated from Scryfall and restricted to sets released within the past 2 years that have at least 3 paper rares.
- Optional toggle to include Commander sets in the eligible-set pool.
- Progress bar while set eligibility validation is in progress.
- Graceful fallback: if Scryfall eligibility checks fail, the app can still show recent sets with a warning.
- Random rare generation using Scryfall `/cards/random` with set filtering.
- Duplicate avoidance across the 3 candidate cards.
- Final assigned-card display with a direct Scryfall link.

## Project Files

- `index.html` – app UI.
- `styles.css` – styling.
- `app.js` – app logic and Scryfall API integration.

## Local Run

Because this is a static site, you can run it with any static file server:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Hostverge Deployment

This app is static (HTML/CSS/JS), so on Hostverge you can deploy by uploading:

- `index.html`
- `styles.css`
- `app.js`

into your site’s public web directory (commonly `public_html`). No backend service is required.

## API Used

- Scryfall API docs: <https://scryfall.com/docs/api>
