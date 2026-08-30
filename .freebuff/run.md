# Run instructions

## Reproduce artifacts

No env/artifact files need to be copied from the main checkout. Dependencies:

```
npm install
```

(`node_modules` is already present in the workspace; only needed in a fresh checkout.)

## Run dev server

Default Angular port is 4200, but it is already occupied by another process (pid 2020),
so run on port 4300 instead:

```
npx ng serve --host 0.0.0.0 --port 4300
```

Production build (for reference): `npm run build`
