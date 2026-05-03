# Househunter

Two tools for tracking your PropertyGuru shortlist:

1. **Chrome Extension** — scrapes your shortlist page and exports a JSON file
2. **React + Express App** — upload the JSON, score listings, track enquiry status

---

## Chrome Extension (`/extension`)

### Install
1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `/extension` folder

### Usage
1. Log in to PropertyGuru and open your shortlist:
   `https://www.propertyguru.com.sg/myactivities/shortlist?locale=en`
2. Wait for the page to fully load (scroll to load all listings if needed)
3. Click the extension icon → **Export Shortlist**
4. A JSON file is downloaded automatically

The exported JSON has this shape:
```json
{
  "exportedAt": "2025-01-01T00:00:00.000Z",
  "count": 42,
  "listings": [
    {
      "listingId": "...",
      "title": "The Grand Residence",
      "url": "https://www.propertyguru.com.sg/...",
      "price": "S$1,500,000",
      "pricePerSqft": "S$1,800 psf",
      "size": "850 sqft",
      "address": "123 Orchard Road, District 09",
      "bedrooms": "3",
      "bathrooms": "2",
      "mrtInfo": "3 min to Somerset MRT"
    }
  ]
}
```

---

## App (`/app` + `/server`)

### Local development

```bash
# Install dependencies
cd server && npm install
cd ../app && npm install

# Run server (port 3001)
cd server && npm run dev

# Run Vite dev server (port 5173, proxies /api to 3001)
cd app && npm run dev
```

Set environment variables before running the server:
```
UPLOAD_PASSWORD=your_secret_password
PORT=3001
```

### Configuration

**MRT targets** — edit `/app/src/config/mrtTargets.ts` to change which MRT stations
are used for the MRT Score. Each entry needs `name`, `lat`, and `lng` (WGS84).

**Scoring thresholds** — also in `mrtTargets.ts`:
- `SCORE_5_M` — distance in metres that earns a score of 5 (default: 400m)
- `SCORE_1_M` — distance in metres that earns a score of 1 (default: 2000m)

---

## Railway Deployment

### Required environment variables

| Variable | Description |
|---|---|
| `UPLOAD_PASSWORD` | Password required to upload new shortlist data |
| `PORT` | HTTP port (Railway sets this automatically) |

### Deploy

1. Push this repo to GitHub
2. Create a new Railway project → **Deploy from GitHub repo**
3. Railway will detect the `Dockerfile` automatically
4. Add environment variables in Railway's **Variables** panel
5. Deploy

### Important: ephemeral storage

Railway's filesystem is **ephemeral** — data resets on each redeploy. For this
use case (personal shortlist tracking) this is acceptable: just re-upload your
JSON after a redeploy. If you want persistence, add a Railway Volume mount
at `/app/data`.

---

## Scoring

| Score | Basis |
|---|---|
| **MRT Score (1–5)** | Geocodes address via OneMap API, calculates straight-line distance to the nearest configured target MRT station |
| **Affordability Score (1–5)** | Price relative to your budget ceiling — well under budget scores 5, over budget scores 1 |
| **Size Score (1–5)** | Rank-based within the current dataset — largest listings score 5 |
| **Composite Score** | Weighted average of the three scores; adjust weights in the UI |

## Enquiry Status

Each listing has a status dropdown (persisted server-side):

- Not Contacted
- Enquired
- Viewing Scheduled
- Viewed
- Offer Made
- Rejected
- Shortlisted
