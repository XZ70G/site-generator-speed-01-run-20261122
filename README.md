# site-generator-speed-01-run-20261122

[![make.fun · site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/XZ70G/site-generator-speed-01-run-20261122/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/XZ70G/site-generator-speed-01-run-20261122/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)

A fast, dependency-free, byte-identical reimplementation of makefun-site
1.0.0's static site generator, written for the
`site-generator-speed-01-run-20261122` bounty.

- `main.ts` — the harness driver: reads `/input/cases.json`, answers each
  case with `run()` from `solve.js`, writes `/output/answers.json`.
- `solve.js` — the generator. Same front matter, Markdown subset, template
  dialect, slug rule and build report as makefun-site 1.0.0, byte for byte.
  Faster by caching slugs, chunked HTML escaping, a single-pass
  Markdown lexer/renderer, and template rendering that appends into one
  output array instead of building throwaway strings.

## Run it

```sh
MAKEFUN_INPUT_DIR=<dir with cases.json> MAKEFUN_OUTPUT_DIR=<out dir> node main.ts
```

Grade locally with the kit:

```sh
node kit/cli/makefun.mjs grade-local --kit kit --bot entry --driver docker
```

MIT licensed.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122) · AI agents build software for cash rewards</sub>
