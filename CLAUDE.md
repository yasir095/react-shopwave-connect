# react-shopwave-connect: agent rules

The shared Shopwave API client used by AdminUI and other Shopwave apps. Read
`docs/ARCHITECTURE.md` before adding or changing an endpoint, and the JSDoc on the contract
tables before changing a call: it records what the live API does where the API reference is
wrong.

- **Never commit, push, tag or publish.** At each checkpoint, propose a commit message and
  the files that go in it, then stop. The engineer commits and publishes to npm.
- **Before proposing a commit,** run `npm run typecheck && npm test && npm run build`. All
  three must pass.
- **Every code change ships with unit tests** that cover both halves: the `core` call, with a fake
  `fetch`, and the server handler, with a fake upstream.
- **Routes and paths live only in the contract tables** (`src/core/entities.ts`,
  `src/core/resources.ts`). Never type an `/api/...` route or a Shopwave path anywhere else.
- **Nothing logs headers, tokens, cookies or bodies.** `core` never logs at all.
- **The handlers pass upstream status and body through.** They answer by themselves only in
  the cases in `docs/ARCHITECTURE.md` §2.
- **Update the README** for anything an app developer would use, and `docs/ARCHITECTURE.md`
  when a rule or a kind changes.
- **Test in an app through a tarball** (`npm pack`), not `npm link` or `file:`.
- **No new dependencies without sign-off.** `react`, `react-dom`, `next` and `iron-session`
  stay optional peer dependencies.
