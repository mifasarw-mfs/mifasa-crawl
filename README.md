# mifasa-crawl

Free scheduled crawlers that collect public RSS/Atom news and selected article pages for the MIFASA site. The scripts use Node.js 18+ and have no npm dependencies.

## GitHub Actions

The active crawler workflow is `.github/workflows/crawl.yml`. It runs parser self-tests, crawls RSS/Atom feeds every 15 minutes, checks sites without feeds hourly, and uploads generated JSON to Neocities when data changes. You can also run it manually from the **Actions** tab.

Add the following repository secret before enabling Neocities uploads:

- `NEOCITIES_API_KEY` — Neocities API key with permission to upload files.

The generated files are `crawl-news.json`, `crawl-words.json`, and `crawl-knowledge.json`. The knowledge crawler reads topics from `crawl-topics.json` and uses Wikipedia's public API.

## Run locally

```sh
node crawl.js --selftest
node crawl-knowledge.js --selftest
node crawl.js --test
node crawl.js
node crawl-knowledge.js
```

`crawl.js --test` checks configured feeds without writing output. `crawl.js --dry` crawls and prints a sample without writing files. `crawl-knowledge.js --force` refreshes every topic.

Workflows must be placed under `.github/workflows/` to run. The root-level `crawl.yml`, `learn.yml`, and `teach.yml` are not active GitHub Actions workflows; the `learn` and `teach` scripts can publish AI-generated content automatically, so review their behavior and safeguards before activating them.
