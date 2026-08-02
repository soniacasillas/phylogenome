# PhyloGenome Play Online

A two-player online tabletop for the Genome Edition and Extinction Edition of PhyloGenome.

## Run it locally

1. Install [Node.js 18 or later](https://nodejs.org/).
2. In this folder, run `npm install` once.
3. Run `npm start` and open `http://localhost:3000` in two browser windows (or devices on the same network).
4. Create a room in one window, share the six-character code, and join it from the other.

## Deploy for internet play

This is a small Node application (Express + Socket.IO), so deploy the repository to Render, Railway, Fly.io, or another Node host. Set the start command to `npm start`; the host supplies `PORT` automatically. No WordPress account, database, or API key is needed: the app server reads published cards through WordPress's public REST API, avoiding browser CORS restrictions.

## WordPress requirements

The site needs the normal public endpoint `/wp-json/wp/v2/posts?_embed=1` to be reachable by the deployed app server. Cards are classified from category and taxonomy display names. The app recognises WordPress's custom `sequencing_generation` and `conservation-status` taxonomies as well as the categories. Keep the names in the game materials (`Species`, `Event`, `Progress`, sequencing generations 1-3, and the conservation statuses CR/EN/VU/LC) in the post taxonomy so the deck builder can find them.

## Current scope

The tabletop shares drawing, hands, discard, progress stacks, a 20x20 grid, movements, undo, turn guidance, and private opponent cards. It intentionally does not auto-enforce card effects or compatibility/removal rules; the turn guide is there for players to apply the printed rules together. Final score currently shows a provisional count, awaiting transcription/confirmation of the scoring sections of the rulebooks.

