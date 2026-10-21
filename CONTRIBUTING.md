# Contributing

Thanks for contributing to Home Memory Agent. Check
[`docs/development.md`](docs/development.md) before changing behavior.

Before opening a pull request, run:

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

Add or update a Gherkin scenario for every user-visible behavior change.
Use deterministic fake models in automated tests. Never include a live
memory, provider credential, personal prompt, or private backup in a
commit or pull request.

Keep server-side provider code out of `apps/web` and
`packages/shared`. The API must validate every LLM-proposed operation
and must not write a memory until the user approves that exact
operation.
